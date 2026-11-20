import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import { ErroMensagemPermanente } from '@/shared/messaging/domain/mensageria.errors';
import { COMANDO_CANCELAR_TAREFA } from '@/shared/messaging/envelope';
import { CancelarTarefaUseCase } from '../../application/use-cases/cancelar-tarefa.use-case';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import { ProcessadorCancelarTarefa } from './processador-cancelar-tarefa';

describe('ProcessadorCancelarTarefa', () => {
  const cancelar = { execute: jest.fn() };
  const processador = new ProcessadorCancelarTarefa(
    cancelar as unknown as CancelarTarefaUseCase,
  );

  it('repassa comando válido ao caso de uso', async () => {
    const ctx = {} as ContextoTransacao;
    const envelope = {
      eventId: 'e1',
      eventType: COMANDO_CANCELAR_TAREFA,
      version: 1,
      occurredAt: '2026-11-15T12:00:00.000Z',
      source: 'os',
      correlationId: 'corr',
      causationId: null,
      ordemServicoId: 'os-1',
      rodada: 1,
      payload: { tipoTarefa: TipoTarefa.REPARO, motivo: 'x' },
    };

    await processador.processar(ctx, envelope);

    expect(cancelar.execute).toHaveBeenCalledWith(ctx, envelope, {
      tipoTarefa: TipoTarefa.REPARO,
      motivo: 'x',
    });
  });

  it('recusa tipoTarefa inválido', async () => {
    await expect(
      processador.processar({} as ContextoTransacao, {
        eventId: 'e1',
        eventType: COMANDO_CANCELAR_TAREFA,
        version: 1,
        occurredAt: '',
        source: 'os',
        correlationId: 'c',
        causationId: null,
        ordemServicoId: 'os-1',
        rodada: 1,
        payload: { tipoTarefa: 'INVALIDO' },
      }),
    ).rejects.toBeInstanceOf(ErroMensagemPermanente);
  });
});
