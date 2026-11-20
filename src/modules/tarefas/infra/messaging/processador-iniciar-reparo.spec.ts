import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import { ErroMensagemPermanente } from '@/shared/messaging/domain/mensageria.errors';
import {
  COMANDO_INICIAR_REPARO,
  type EnvelopeMensagem,
} from '@/shared/messaging/envelope';
import type { CriarTarefaReparoUseCase } from '../../application/use-cases/criar-tarefa-reparo.use-case';
import { ProcessadorIniciarReparo } from './processador-iniciar-reparo';

describe('ProcessadorIniciarReparo', () => {
  const contexto = {} as ContextoTransacao;
  const criarTarefa = { execute: jest.fn() };
  let processador: ProcessadorIniciarReparo;

  const payloadValido = {
    itensOficiais: [
      {
        tipo: 'SERVICO',
        itemId: 'svc-1',
        nome: 'Troca',
        quantidade: 1,
      },
    ],
  };

  const envelopeBase: EnvelopeMensagem = {
    eventId: 'evt-1',
    eventType: COMANDO_INICIAR_REPARO,
    version: 1,
    occurredAt: '2026-11-15T11:00:00.000Z',
    source: 'os-service',
    correlationId: 'corr-1',
    causationId: null,
    ordemServicoId: 'os-1',
    rodada: 1,
    payload: payloadValido,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    criarTarefa.execute.mockResolvedValue(true);
    processador = new ProcessadorIniciarReparo(
      criarTarefa as unknown as CriarTarefaReparoUseCase,
    );
  });

  it('delega ao caso de uso com itens oficiais normalizados', async () => {
    await processador.processar(contexto, envelopeBase);
    expect(criarTarefa.execute).toHaveBeenCalledWith(contexto, {
      ordemServicoId: 'os-1',
      rodada: 1,
      correlationId: 'corr-1',
      itensOficiais: payloadValido.itensOficiais,
    });
  });

  it.each([
    ['rodada inválida', { ...envelopeBase, rodada: 0 }],
    ['itensOficiais ausentes', { ...envelopeBase, payload: {} }],
  ])('erro permanente: %s', async (_nome, envelope) => {
    await expect(
      processador.processar(contexto, envelope as EnvelopeMensagem),
    ).rejects.toBeInstanceOf(ErroMensagemPermanente);
  });
});
