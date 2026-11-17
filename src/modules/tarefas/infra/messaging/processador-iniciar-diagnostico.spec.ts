import { ContextoTransacaoFake } from '@/shared/database/unit-of-work-fake';
import { ErroMensagemPermanente } from '@/shared/messaging/domain/mensageria.errors';
import type { EnvelopeMensagem } from '@/shared/messaging/envelope';
import type { CriarTarefaDiagnosticoUseCase } from '../../application/use-cases/criar-tarefa-diagnostico.use-case';
import { ProcessadorIniciarDiagnostico } from './processador-iniciar-diagnostico';

describe('ProcessadorIniciarDiagnostico', () => {
  const contexto = new ContextoTransacaoFake();
  let criarTarefa: { execute: jest.Mock };
  let processador: ProcessadorIniciarDiagnostico;

  const criarEnvelope = (
    payload: unknown,
    patch: Partial<EnvelopeMensagem> = {},
  ): EnvelopeMensagem => ({
    eventId: 'evt-1',
    eventType: 'execution.iniciar-diagnostico.v1',
    version: 1,
    occurredAt: '2026-11-15T10:00:00.000Z',
    source: 'os-service',
    correlationId: 'corr-1',
    causationId: null,
    ordemServicoId: 'os-1',
    rodada: 1,
    payload,
    ...patch,
  });

  const payloadValido = {
    veiculo: { placa: 'ABC1D23', modelo: 'Sedan' },
    descricaoProblema: 'Barulho ao frear',
    sugestoes: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
  };

  beforeEach(() => {
    criarTarefa = { execute: jest.fn().mockResolvedValue(true) };
    processador = new ProcessadorIniciarDiagnostico(
      criarTarefa as unknown as CriarTarefaDiagnosticoUseCase,
    );
  });

  it('consome o comando iniciar-diagnostico.v1', () => {
    expect(processador.eventType).toBe('execution.iniciar-diagnostico.v1');
  });

  it('cria a tarefa com os dados do envelope', async () => {
    await processador.processar(contexto, criarEnvelope(payloadValido));

    expect(criarTarefa.execute).toHaveBeenCalledWith(contexto, {
      ordemServicoId: 'os-1',
      rodada: 1,
      correlationId: 'corr-1',
      veiculo: { placa: 'ABC1D23', modelo: 'Sedan' },
      descricaoProblema: 'Barulho ao frear',
      sugestoes: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
    });
  });

  it('aceita comando sem sugestões', async () => {
    const { sugestoes: _sugestoes, ...semSugestoes } = payloadValido;

    await processador.processar(contexto, criarEnvelope(semSugestoes));

    expect(criarTarefa.execute.mock.calls[0][1].sugestoes).toEqual([]);
  });

  it.each([
    ['payload ausente', criarEnvelope(null)],
    [
      'veículo inválido',
      criarEnvelope({ ...payloadValido, veiculo: { placa: 'X' } }),
    ],
    [
      'descrição inválida',
      criarEnvelope({ ...payloadValido, descricaoProblema: 10 }),
    ],
    [
      'sugestões fora de lista',
      criarEnvelope({ ...payloadValido, sugestoes: 'x' }),
    ],
    [
      'item sem quantidade positiva',
      criarEnvelope({
        ...payloadValido,
        sugestoes: [{ tipo: 'PECA', itemId: 'p', quantidade: 0 }],
      }),
    ],
    [
      'tipo de item desconhecido',
      criarEnvelope({
        ...payloadValido,
        sugestoes: [{ tipo: 'OUTRO', itemId: 'p', quantidade: 1 }],
      }),
    ],
    ['rodada inválida', criarEnvelope(payloadValido, { rodada: 0 })],
    [
      'ordem de serviço vazia',
      criarEnvelope(payloadValido, { ordemServicoId: '' }),
    ],
  ])('rejeita como permanente: %s', async (_nome, envelope) => {
    await expect(
      processador.processar(contexto, envelope),
    ).rejects.toBeInstanceOf(ErroMensagemPermanente);
    expect(criarTarefa.execute).not.toHaveBeenCalled();
  });
});
