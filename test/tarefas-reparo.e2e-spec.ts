import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TipoTarefa } from '@/modules/tarefas/domain/tipo-tarefa.enum';
import { configurarAplicacao } from '@/shared/http/aplicacao.config';
import { ProcessarMensagemEntradaService } from '@/shared/messaging/application/services/processar-mensagem-entrada.service';
import { AppModule } from '../src/app.module';
import {
  criarClienteDynamodbTeste,
  criarTabelasIsoladasDynamodb,
  type NomesTabelasDynamodb,
  removerTabelasDynamodb,
} from './helpers/dynamodb-test-setup';
import {
  criarComandoCancelarTarefa,
  criarComandoIniciarDiagnostico,
  criarComandoIniciarReparo,
} from './helpers/envelope-teste';
import { assinarJwtRs256, gerarParDeChavesRsa } from './helpers/jwt-test';

describe('Tarefas de reparo e interrupção (e2e)', () => {
  const chaves = gerarParDeChavesRsa();
  const client = criarClienteDynamodbTeste();
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

  const corpoReparoBase = {
    servicosRealizados: [
      { itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', quantidade: 1 },
    ],
    pecasUtilizadas: [
      { itemId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', quantidade: 2 },
    ],
  };

  async function criarReparoPendente(): Promise<string> {
    const comando = criarComandoIniciarReparo();
    await processarComando.executar(JSON.stringify(comando));
    return `${comando.ordemServicoId}#${comando.rodada}#REPARO`;
  }

  beforeAll(async () => {
    tabelas = await criarTabelasIsoladasDynamodb(client, 'e2e-reparo');
    Object.assign(process.env, {
      AWS_REGION: 'us-east-1',
      DYNAMODB_ENDPOINT:
        process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
      DYNAMODB_TAREFAS_TABLE: tabelas.tarefas,
      DYNAMODB_OUTBOX_TABLE: tabelas.outbox,
      DYNAMODB_MENSAGENS_PROCESSADAS_TABLE: tabelas.mensagensProcessadas,
      JWT_PUBLIC_KEY: chaves.publicKey,
      OS_SERVICE_BASE_URL: 'http://127.0.0.1:9',
      OS_SERVICE_TOKEN: 'execution-os-token',
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
    await removerTabelasDynamodb(client, tabelas);
    client.destroy();
  });

  it('inicia reparo com mecânico responsável', async () => {
    const tarefaId = await criarReparoPendente();
    const resposta = await request(app.getHttpServer())
      .post(urlTarefa(tarefaId, '/inicio'))
      .set(bearer());
    expect(resposta.status).toBe(200);
    expect(resposta.body.situacao).toBe('EM_ANDAMENTO');
  });

  it('conclui reparo com consumo e divergência inferiores', async () => {
    const tarefaId = await criarReparoPendente();
    await request(app.getHttpServer())
      .post(urlTarefa(tarefaId, '/inicio'))
      .set(bearer())
      .expect(200);
    const resposta = await request(app.getHttpServer())
      .post(urlTarefa(tarefaId, '/conclusao'))
      .set(bearer())
      .send(corpoReparoBase);
    expect(resposta.status).toBe(200);
    expect(resposta.body.situacao).toBe('CONCLUIDA');
  });

  it('registra falha de reparo', async () => {
    const tarefaId = await criarReparoPendente();
    await request(app.getHttpServer())
      .post(urlTarefa(tarefaId, '/inicio'))
      .set(bearer())
      .expect(200);
    const resposta = await request(app.getHttpServer())
      .post(urlTarefa(tarefaId, '/falha'))
      .set(bearer())
      .send({ motivo: 'Incompatível', ...corpoReparoBase });
    expect(resposta.status).toBe(200);
    expect(resposta.body.situacao).toBe('FALHOU');
  });

  it('recusa conclusão sem justificativa quando consumo exige divergência D2.18', async () => {
    const tarefaId = await criarReparoPendente();
    await request(app.getHttpServer())
      .post(urlTarefa(tarefaId, '/inicio'))
      .set(bearer())
      .expect(200);
    const resposta = await request(app.getHttpServer())
      .post(urlTarefa(tarefaId, '/conclusao'))
      .set(bearer())
      .send({
        servicosRealizados: corpoReparoBase.servicosRealizados,
        pecasUtilizadas: [
          { itemId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantidade: 1 },
        ],
        justificativaDivergencia: '',
      });
    expect(resposta.status).toBe(422);
  });

  describe('interrupção', () => {
    it('interrompe após cancelamento solicitar interrupção', async () => {
      const comando = criarComandoIniciarReparo();
      const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#REPARO`;
      await processarComando.executar(JSON.stringify(comando));
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);
      await processarComando.executar(
        JSON.stringify(
          criarComandoCancelarTarefa(
            { ordemServicoId: comando.ordemServicoId },
            TipoTarefa.REPARO,
          ),
        ),
      );
      const resposta = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/interrupcao'))
        .set(bearer())
        .send(corpoReparoBase);
      expect(resposta.status).toBe(200);
      expect(resposta.body.situacao).toBe('INTERROMPIDA');
    });

    it('403 para mecânico não responsável na interrupção', async () => {
      const comando = criarComandoIniciarReparo();
      const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#REPARO`;
      await processarComando.executar(JSON.stringify(comando));
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer('MECANICO', 'mec-1'))
        .expect(200);
      await processarComando.executar(
        JSON.stringify(
          criarComandoCancelarTarefa(
            { ordemServicoId: comando.ordemServicoId },
            TipoTarefa.REPARO,
          ),
        ),
      );
      const resposta = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/interrupcao'))
        .set(bearer('MECANICO', 'mec-2'))
        .send(corpoReparoBase);
      expect(resposta.status).toBe(403);
    });

    it('409 para interrupção sem solicitação prévia', async () => {
      const tarefaId = await criarReparoPendente();
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);
      const resposta = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/interrupcao'))
        .set(bearer())
        .send(corpoReparoBase);
      expect(resposta.status).toBe(409);
    });
  });

  describe('tipo de tarefa', () => {
    it('recusa rotas de reparo em tarefa de diagnóstico', async () => {
      const comando = criarComandoIniciarDiagnostico();
      await processarComando.executar(JSON.stringify(comando));
      const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#DIAGNOSTICO`;
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/falha'))
            .set(bearer())
            .send({ motivo: 'x', ...corpoReparoBase })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/interrupcao'))
            .set(bearer())
            .send(corpoReparoBase)
        ).status,
      ).toBe(409);
    });
  });

  describe('autorização e ownership', () => {
    it('403 para CLIENTE em início, conclusão, falha e interrupção', async () => {
      const tarefaId = await criarReparoPendente();
      const cliente = bearer('CLIENTE' as 'MECANICO');
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/inicio'))
            .set(cliente)
        ).status,
      ).toBe(403);
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/conclusao'))
            .set(cliente)
            .send(corpoReparoBase)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/falha'))
            .set(cliente)
            .send({ motivo: 'x', ...corpoReparoBase })
        ).status,
      ).toBe(403);
      await processarComando.executar(
        JSON.stringify(
          criarComandoCancelarTarefa(
            { ordemServicoId: tarefaId.split('#')[0] ?? '' },
            TipoTarefa.REPARO,
          ),
        ),
      );
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/interrupcao'))
            .set(cliente)
            .send(corpoReparoBase)
        ).status,
      ).toBe(403);
    });

    it('403 para mecânico não responsável em conclusão e falha', async () => {
      const tarefaId = await criarReparoPendente();
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer('MECANICO', 'mec-1'))
        .expect(200);
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/conclusao'))
            .set(bearer('MECANICO', 'mec-2'))
            .send(corpoReparoBase)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/falha'))
            .set(bearer('MECANICO', 'mec-2'))
            .send({ motivo: 'x', ...corpoReparoBase })
        ).status,
      ).toBe(403);
    });
  });

  describe('autenticação e cancelamento', () => {
    it('401 sem token em início de reparo', async () => {
      const tarefaId = await criarReparoPendente();
      const resposta = await request(app.getHttpServer()).post(
        urlTarefa(tarefaId, '/inicio'),
      );
      expect(resposta.status).toBe(401);
    });

    it('recusa iniciar reparo já cancelado', async () => {
      const tarefaId = await criarReparoPendente();
      const ordemServicoId = tarefaId.split('#')[0] ?? '';
      await processarComando.executar(
        JSON.stringify(
          criarComandoCancelarTarefa({ ordemServicoId }, TipoTarefa.REPARO),
        ),
      );
      const resposta = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer());
      expect(resposta.status).toBe(409);
    });

    it('recusa concluir durante INTERRUPCAO_SOLICITADA', async () => {
      const comando = criarComandoIniciarReparo();
      const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#REPARO`;
      await processarComando.executar(JSON.stringify(comando));
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);
      await processarComando.executar(
        JSON.stringify(
          criarComandoCancelarTarefa(
            { ordemServicoId: comando.ordemServicoId },
            TipoTarefa.REPARO,
          ),
        ),
      );
      const resposta = await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/conclusao'))
        .set(bearer())
        .send(corpoReparoBase);
      expect(resposta.status).toBe(409);
    });

    it('recusa conclusão e falha após cancelamento', async () => {
      const tarefaId = await criarReparoPendente();
      const ordemServicoId = tarefaId.split('#')[0] ?? '';
      await request(app.getHttpServer())
        .post(urlTarefa(tarefaId, '/inicio'))
        .set(bearer())
        .expect(200);
      await processarComando.executar(
        JSON.stringify(
          criarComandoCancelarTarefa({ ordemServicoId }, TipoTarefa.REPARO),
        ),
      );
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/conclusao'))
            .set(bearer())
            .send(corpoReparoBase)
        ).status,
      ).toBe(409);
      expect(
        (
          await request(app.getHttpServer())
            .post(urlTarefa(tarefaId, '/falha'))
            .set(bearer())
            .send({ motivo: 'x', ...corpoReparoBase })
        ).status,
      ).toBe(409);
    });

    it('ADMINISTRADOR pode listar reparos', async () => {
      await criarReparoPendente();
      const resposta = await request(app.getHttpServer())
        .get('/v1/tarefas?tipo=REPARO')
        .set(bearer('ADMINISTRADOR'));
      expect(resposta.status).toBe(200);
    });
  });
});
