import type { ConfigService } from '@nestjs/config';
import type { PedidoConclusaoDiagnosticoOs } from '../../application/ports/conclusao-diagnostico-os.gateway';
import { FetchConclusaoDiagnosticoOsGateway } from './fetch-conclusao-diagnostico-os.gateway';

describe('FetchConclusaoDiagnosticoOsGateway', () => {
  const pedido: PedidoConclusaoDiagnosticoOs = {
    ordemServicoId: 'os-1',
    rodada: 1,
    tarefaId: 'os-1#1#DIAGNOSTICO',
    laudo: 'Laudo',
    itens: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
    correlationId: 'corr-1',
    requestId: 'req-1',
  };
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  const criarGateway = (env: Record<string, string> = {}) =>
    new FetchConclusaoDiagnosticoOsGateway({
      get: (chave: string) => env[chave],
    } as unknown as ConfigService);

  const responder = (status: number, corpo?: unknown, texto?: string) =>
    fetchMock.mockResolvedValue({
      status,
      text: async () =>
        texto ?? (corpo === undefined ? '' : JSON.stringify(corpo)),
    });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = fetchOriginal;
  });

  it('envia a conclusão com token, chave idempotente e cabeçalhos de rastreio', async () => {
    responder(200, { rodada: 1, itensOficiais: [] });
    const gateway = criarGateway({
      OS_SERVICE_BASE_URL: 'http://os.local/',
      OS_SERVICE_TOKEN: 'execution-os-token',
    });

    await gateway.concluir(pedido);

    const [url, opcoes] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://os.local/internal/ordens-servico/os-1/diagnostico',
    );
    expect(opcoes.method).toBe('POST');
    expect(opcoes.headers).toMatchObject({
      Authorization: 'Bearer execution-os-token',
      'Idempotency-Key': 'diagnostico:os-1#1#DIAGNOSTICO',
      'X-Correlation-Id': 'corr-1',
      'X-Request-Id': 'req-1',
    });
    expect(JSON.parse(opcoes.body)).toEqual({
      rodada: 1,
      tarefaId: 'os-1#1#DIAGNOSTICO',
      laudo: 'Laudo',
      itens: pedido.itens,
    });
    expect(opcoes.signal).toBeInstanceOf(AbortSignal);
  });

  it('usa os padrões de URL e timeout quando a configuração está ausente', async () => {
    responder(200, { rodada: 1, itensOficiais: [] });

    await criarGateway().concluir(pedido);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:8080/internal/ordens-servico/os-1/diagnostico',
    );
  });

  it('devolve sucesso com os itens oficiais no 200', async () => {
    const itensOficiais = [
      { tipo: 'PECA', itemId: 'peca-1', nome: 'Pastilha', quantidade: 2 },
    ];
    responder(200, { rodada: 1, itensOficiais });

    await expect(criarGateway().concluir(pedido)).resolves.toEqual({
      tipo: 'sucesso',
      rodada: 1,
      itensOficiais,
    });
  });

  it('trata 200 sem itensOficiais ou ilegível como indeterminado', async () => {
    responder(200, { rodada: 1 });
    await expect(criarGateway().concluir(pedido)).resolves.toMatchObject({
      tipo: 'indeterminado',
    });

    responder(200, undefined, 'não é json');
    await expect(criarGateway().concluir(pedido)).resolves.toMatchObject({
      tipo: 'indeterminado',
    });
  });

  it.each([409, 422, 400, 404])(
    'devolve recusada para %i com código do OS',
    async (status) => {
      responder(status, { codigo: 'ITEM_INVALIDO', mensagem: 'Item inválido' });

      await expect(criarGateway().concluir(pedido)).resolves.toEqual({
        tipo: 'recusada',
        status,
        codigo: 'ITEM_INVALIDO',
        mensagem: 'Item inválido',
      });
    },
  );

  it('devolve recusada com código padrão quando o corpo 4xx não é reconhecido', async () => {
    responder(422, undefined, '<html>');

    await expect(criarGateway().concluir(pedido)).resolves.toEqual({
      tipo: 'recusada',
      status: 422,
      codigo: 'HTTP_422',
      mensagem: 'Conclusão recusada pelo OS.',
    });
  });

  it('trata 5xx como indeterminado', async () => {
    responder(503, { codigo: 'INDISPONIVEL' });

    await expect(criarGateway().concluir(pedido)).resolves.toEqual({
      tipo: 'indeterminado',
      motivo: 'HTTP 503 inesperado',
    });
  });

  it('trata timeout e erro de rede como indeterminado', async () => {
    fetchMock.mockRejectedValueOnce(new Error('The operation was aborted'));
    await expect(criarGateway().concluir(pedido)).resolves.toEqual({
      tipo: 'indeterminado',
      motivo: 'The operation was aborted',
    });

    fetchMock.mockRejectedValueOnce('falha');
    await expect(criarGateway().concluir(pedido)).resolves.toMatchObject({
      tipo: 'indeterminado',
      motivo: 'Erro de rede na conclusão',
    });
  });
});
