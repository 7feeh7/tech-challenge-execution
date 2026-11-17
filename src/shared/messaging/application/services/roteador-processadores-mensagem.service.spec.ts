import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import { ContextoTransacaoFake } from '@/shared/database/unit-of-work-fake';
import { ErroMensagemPermanente } from '../../domain/mensageria.errors';
import type { ProcessadorMensagem } from '../ports/processador-mensagem.port';
import { RoteadorProcessadoresMensagemService } from './roteador-processadores-mensagem.service';

describe('RoteadorProcessadoresMensagemService', () => {
  const processador: ProcessadorMensagem = {
    eventType: 'tipo.v1',
    processar: async (_ctx: ContextoTransacao) => undefined,
  };

  it('encaminha para processador registrado', async () => {
    const roteador = new RoteadorProcessadoresMensagemService([processador]);
    await expect(
      roteador.processar(new ContextoTransacaoFake(), {
        eventId: '1',
        eventType: 'tipo.v1',
        version: 1,
        occurredAt: 't',
        source: 's',
        correlationId: 'c',
        causationId: null,
        ordemServicoId: 'os',
        rodada: 1,
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('recusa tipo sem processador', async () => {
    const roteador = new RoteadorProcessadoresMensagemService([]);
    await expect(
      roteador.processar(new ContextoTransacaoFake(), {
        eventId: '1',
        eventType: 'desconhecido.v1',
        version: 1,
        occurredAt: 't',
        source: 's',
        correlationId: 'c',
        causationId: null,
        ordemServicoId: 'os',
        rodada: 1,
        payload: {},
      }),
    ).rejects.toBeInstanceOf(ErroMensagemPermanente);
  });
});
