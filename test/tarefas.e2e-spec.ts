import { randomUUID } from 'node:crypto';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarAplicacao } from '../src/shared/http/aplicacao.config';
import { ProcessarMensagemEntradaService } from '../src/shared/messaging/application/services/processar-mensagem-entrada.service';
import {
  criarClienteDynamodbTeste,
  criarTabelasIsoladasDynamodb,
  type NomesTabelasDynamodb,
  removerTabelasDynamodb,
} from './helpers/dynamodb-test-setup';
import { criarComandoIniciarDiagnostico } from './helpers/envelope-teste';
import {
  assinarJwtHs256,
  assinarJwtRs256,
  gerarParDeChavesRsa,
} from './helpers/jwt-test';
import { OsHttpDouble } from './helpers/os-http-double';

describe('Tarefas de diagnóstico (e2e)', () => {
  const chaves = gerarParDeChavesRsa();
  const chavesDeOutroEmissor = gerarParDeChavesRsa();
  const os = new OsHttpDouble();
  const client: DynamoDBClient = criarClienteDynamodbTeste();
  let tabelas: NomesTabelasDynamodb;
  let app: NestFastifyApplication;
  let processarComando: ProcessarMensagemEntradaService;

  const token = (perfil: string, sub = 'mec-1') =>
    assinarJwtRs256(chaves.privateKey, {
      sub,
      email: `${sub}@oficina.com`,
      perfil,
    });
  const bearer = (perfil = 'MECANICO', sub = 'mec-1') => ({
    Authorization: `Bearer ${token(perfil, sub)}`,
  });
  const urlTarefa = (tarefaId: string, acao = '') =>
    `/v1/tarefas/${encodeURIComponent(tarefaId)}${acao}`;

  async function criarTarefaPendente(rodada = 1): Promise<string> {
    const comando = criarComandoIniciarDiagnostico({ rodada });
    await processarComando.executar(JSON.stringify(comando));
    return `${comando.ordemServicoId}#${rodada}#DIAGNOSTICO`;
  }

  const corpoConclusao = {
    laudo: 'Pastilhas desgastadas',
    itens: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
  };

  beforeAll(async () => {
    const osUrl = await os.iniciar();
    tabelas = await criarTabelasIsoladasDynamodb(client, 'e2e-tarefas');
    Object.assign(process.env, {
      AWS_REGION: 'us-east-1',
      DYNAMODB_ENDPOINT:
        process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
      DYNAMODB_TAREFAS_TABLE: tabelas.tarefas,
      DYNAMODB_OUTBOX_TABLE: tabelas.outbox,
      DYNAMODB_MENSAGENS_PROCESSADAS_TABLE: tabelas.mensagensProcessadas,
      JWT_PUBLIC_KEY: chaves.publicKey,
      OS_SERVICE_BASE_URL: osUrl,
      OS_SERVICE_TOKEN: 'execution-os-token',
      OS_REQUEST_TIMEOUT_MS: '400',
    });

    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configurarAplicacao(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    processarComando = app.get(ProcessarMensagemEntradaService);
  });

  afterAll(async () => {
    await app.close();
    await os.parar();
    await removerTabelasDynamodb(client, tabelas);
    client.destroy();
  });

  beforeEach(() => os.reiniciar());

  describe('autenticação e autorização (RS256)', () => {
    it('mantém o health público', async () => {
      const resposta = await request(app.getHttpServer()).get('/health');

      expect(resposta.status).toBe(200);
    });

    it('responde 401 sem token', async () => {
      const resposta = await request(app.getHttpServer()).get('/v1/tarefas');

      expect(resposta.status).toBe(401);
    });

    it('responde 401 para token assinado por outra chave', async () => {
      const intruso = assinarJwtRs256(chavesDeOutroEmissor.privateKey, {
        sub: 'mec-1',
        email: 'a@b.com',
        perfil: 'MECANICO',
      });

      const resposta = await request(app.getHttpServer())
        .get('/v1/tarefas')
        .set('Authorization', `Bearer ${intruso}`);

      expect(resposta.status).toBe(401);
    });

    it('responde 401 para token HS256 assinado com a chave pública', async () => {
      const hs256 = assinarJwtHs256(chaves.publicKey, {
        sub: 'mec-1',
        email: 'a@b.com',
        perfil: 'MECANICO',
      });

      const resposta = await request(app.getHttpServer())
        .get('/v1/tarefas')
        .set('Authorization', `Bearer ${hs256}`);

      expect(resposta.status).toBe(401);
    });

    it('responde 401 para token expirado', async () => {
      const expirado = assinarJwtRs256(
        chaves.privateKey,
        { sub: 'mec-1', email: 'a@b.com', perfil: 'MECANICO' },
        -60,
      );

      const resposta = await request(app.getHttpServer())
        .get('/v1/tarefas')
        .set('Authorization', `Bearer ${expirado}`);

      expect(resposta.status).toBe(401);
    });

    it.each(['ATENDENTE', 'CLIENTE'])(
      'responde 403 para o perfil %s',
      async (perfil) => {
        const resposta = await request(app.getHttpServer())
          .get('/v1/tarefas')
          .set(bearer(perfil));

        expect(resposta.status).toBe(403);
      },
    );

    it.each(['MECANICO', 'ADMINISTRADOR'])(
      'aceita o perfil %s',
      async (perfil) => {
        const resposta = await request(app.getHttpServer())
          .get('/v1/tarefas')
          .set(bearer(perfil));

        expect(resposta.status).toBe(200);
      },
    );
  });

  describe('ciclo da tarefa', () => {
    it('lista a fila em ordem de chegada e tira da fila a tarefa iniciada', async () => {
      const primeira = await criarTarefaPendente();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const segunda = await criarTarefaPendente();

      const lista = await request(app.getHttpServer())
        .get('/v1/tarefas?tipo=DIAGNOSTICO&limite=100')
        .set(bearer());
      const ids = lista.body.itens.map((t: { id: string }) => t.id);
      expect(ids.indexOf(primeira)).toBeLessThan(ids.indexOf(segunda));

      await request(app.getHttpServer())
        .post(urlTarefa(primeira, '/inicio'))
        .set(bearer())
        .expect(200);

      const depois = await request(app.getHttpServer())
        .get('/v1/tarefas?limite=100')
        .set(bearer());
      const idsDepois = depois.body.itens.map((t: { id: string }) => t.id);
      expect(idsDepois).not.toContain(primeira);
      expect(idsDepois).toContain(segunda);
    });

    it('rejeita parâmetros de listagem inválidos', async () => {
      const resposta = await request(app.getHttpServer())
        .get('/v1/tarefas?situacao=CONCLUIDA&limite=0')
        .set(bearer());

      expect(resposta.status).toBe(400);
    });

    it('inicia, impede devolução por outro mecânico e devolve pelo responsável', async () => {
      const tarefaId = await criarTarefaPendente();

      const inicio = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer('MECANICO', 'mec-1'));
      expect(inicio.status).toBe(200);
      expect(inicio.body).toMatchObject({
        situacao: 'EM_ANDAMENTO',
        responsavelId: 'mec-1',
      });

      const outro = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/devolucao'))
        .set(bearer('MECANICO', 'mec-2'));
      expect(outro.status).toBe(403);

      const devolucao = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/devolucao'))
        .set(bearer('MECANICO', 'mec-1'));
      expect(devolucao.status).toBe(200);
      expect(devolucao.body.situacao).toBe('PENDENTE');
    });

    it('responde 404 para tarefa inexistente e 409 ao iniciar duas vezes por mecânicos diferentes', async () => {
      await request(app.getHttpServer())
        .get(urlTarefa('inexistente#1#DIAGNOSTICO'))
        .set(bearer())
        .expect(404);

      const tarefaId = await criarTarefaPendente();
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer('MECANICO', 'mec-1'))
        .expect(200);
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer('MECANICO', 'mec-2'))
        .expect(409);
    });

    it('valida o corpo da conclusão', async () => {
      const tarefaId = await criarTarefaPendente();
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);

      const resposta = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/conclusao'))
        .set(bearer())
        .send({
          laudo: '',
          itens: [{ tipo: 'X', itemId: 'p', quantidade: 0 }],
        });

      expect(resposta.status).toBe(400);
      expect(os.requisicoes).toHaveLength(0);
    });

    it('conclui com o 200 do OS enviando token, chave idempotente e payload', async () => {
      const tarefaId = await criarTarefaPendente();
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);
      os.enfileirarResposta({
        status: 200,
        corpo: {
          rodada: 1,
          itensOficiais: [
            { tipo: 'PECA', itemId: 'peca-1', nome: 'Pastilha', quantidade: 2 },
          ],
        },
      });

      const resposta = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/conclusao'))
        .set(bearer())
        .send(corpoConclusao);

      expect(resposta.status).toBe(200);
      expect(resposta.body.tarefa).toMatchObject({
        situacao: 'CONCLUIDA',
        laudo: corpoConclusao.laudo,
      });
      expect(resposta.body.itensOficiais).toHaveLength(1);
      expect(os.requisicoes).toHaveLength(1);
      expect(os.requisicoes[0].headers).toMatchObject({
        authorization: 'Bearer execution-os-token',
        'idempotency-key': `diagnostico:${tarefaId}`,
      });
      expect(os.requisicoes[0].corpo).toMatchObject({
        rodada: 1,
        tarefaId,
        ...corpoConclusao,
      });

      const consulta = await request(app.getHttpServer())
        .get(urlTarefa(tarefaId))
        .set(bearer());
      expect(consulta.body.situacao).toBe('CONCLUIDA');
    });

    it('repassa o 409 do OS ao mecânico e volta a EM_ANDAMENTO', async () => {
      const tarefaId = await criarTarefaPendente();
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);
      os.enfileirarResposta({
        status: 409,
        corpo: {
          codigo: 'ESTADO_INCOMPATIVEL',
          mensagem: 'OS fora de diagnóstico',
        },
      });

      const resposta = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/conclusao'))
        .set(bearer())
        .send(corpoConclusao);

      expect(resposta.status).toBe(409);
      expect(JSON.stringify(resposta.body)).toContain('ESTADO_INCOMPATIVEL');
      const consulta = await request(app.getHttpServer())
        .get(urlTarefa(tarefaId))
        .set(bearer());
      expect(consulta.body).toMatchObject({
        situacao: 'EM_ANDAMENTO',
        conclusaoPendente: null,
      });
    });

    it('repassa o 422 do OS e aceita conteúdo corrigido na nova tentativa', async () => {
      const tarefaId = await criarTarefaPendente();
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);
      os.enfileirarResposta({
        status: 422,
        corpo: { codigo: 'ITEM_INVALIDO', mensagem: 'Item inexistente' },
      });

      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/conclusao'))
        .set(bearer())
        .send(corpoConclusao)
        .expect(422);

      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/conclusao'))
        .set(bearer())
        .send({ laudo: 'Laudo corrigido', itens: [] })
        .expect(200);
      expect(os.requisicoes[1].corpo.laudo).toBe('Laudo corrigido');
    });

    it('mantém o payload pendente no timeout e reenvia o mesmo conteúdo com a mesma chave', async () => {
      const tarefaId = await criarTarefaPendente();
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);
      os.enfileirarResposta({ status: 200, atrasoMs: 1500 });

      const timeout = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/conclusao'))
        .set(bearer())
        .send(corpoConclusao);
      expect(timeout.status).toBe(503);

      const pendente = await request(app.getHttpServer())
        .get(urlTarefa(tarefaId))
        .set(bearer());
      expect(pendente.body).toMatchObject({
        situacao: 'CONCLUSAO_EM_ANDAMENTO',
        conclusaoPendente: corpoConclusao,
      });

      const devolucao = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/devolucao'))
        .set(bearer());
      expect(devolucao.status).toBe(409);

      const nova = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/conclusao'))
        .set(bearer())
        .send({ laudo: 'Conteúdo novo ignorado', itens: [] });
      expect(nova.status).toBe(200);
      expect(os.requisicoes).toHaveLength(2);
      expect(os.requisicoes[1].corpo).toMatchObject(corpoConclusao);
      expect(os.requisicoes[1].headers['idempotency-key']).toBe(
        os.requisicoes[0].headers['idempotency-key'],
      );
    });

    it('permite ao administrador devolver tarefa de qualquer mecânico', async () => {
      const tarefaId = await criarTarefaPendente();
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer('MECANICO', 'mec-1'))
        .expect(200);

      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/devolucao'))
        .set(bearer('ADMINISTRADOR', randomUUID()))
        .expect(200);
    });
  });
});
