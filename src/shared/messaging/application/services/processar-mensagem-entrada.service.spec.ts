import { ConflitoMensagemProcessadaError } from '@/shared/database/tratar-erro-dynamodb-transacao';
import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { ConteudoMensagemDivergenteError } from '../../domain/mensageria.errors';
import {
  criarJsonLoggerMensageriaFake,
  criarMessagingMetricsFake,
} from '../../testing/observabilidade-mensageria.test-doubles';
import { EnvelopeMensagemInvalidoError } from '../../validar-envelope';
import type { MensagemProcessadaGateway } from '../ports/mensagem-processada.gateway';
import type { ProcessadorMensagem } from '../ports/processador-mensagem.port';
import { ProcessarMensagemEntradaService } from './processar-mensagem-entrada.service';
import { RoteadorProcessadoresMensagemService } from './roteador-processadores-mensagem.service';

const logger = criarJsonLoggerMensageriaFake();
const mensageriaMetrics = criarMessagingMetricsFake();

const envelope = {
  eventId: '550e8400-e29b-41d4-a716-446655440099',
  eventType: 'mensageria.teste-integracao.v1',
  version: 1,
  occurredAt: '2026-11-15T10:00:00.000Z',
  source: 'teste',
  correlationId: '550e8400-e29b-41d4-a716-446655440000',
  causationId: null,
  ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
  rodada: 1,
  payload: { marcador: 1 },
};

describe('ProcessarMensagemEntradaService', () => {
  it('rejeita corpo que não é JSON', async () => {
    const servico = new ProcessarMensagemEntradaService(
      new UnitOfWorkFake(),
      {
        jaProcessada: () => Promise.resolve(false),
        registrar: () => Promise.resolve(),
        buscarHash: () => Promise.resolve(null),
      },
      new RoteadorProcessadoresMensagemService([]),
      logger,
      mensageriaMetrics,
    );
    await expect(servico.executar('{invalido')).rejects.toThrow(
      EnvelopeMensagemInvalidoError,
    );
  });

  it('deduplica eventId já processado com mesmo hash', async () => {
    const efeitos: string[] = [];
    const processador: ProcessadorMensagem = {
      eventType: 'mensageria.teste-integracao.v1',
      processar: () => {
        efeitos.push('ok');
        return Promise.resolve();
      },
    };
    const hashes = new Map<string, string>();
    const mensagens: MensagemProcessadaGateway = {
      jaProcessada: (_c, eventId) => Promise.resolve(hashes.has(eventId)),
      registrar: (_c, eventId, hash) => {
        hashes.set(eventId, hash);
        return Promise.resolve();
      },
      buscarHash: (_c, eventId) => Promise.resolve(hashes.get(eventId) ?? null),
    };
    const servico = new ProcessarMensagemEntradaService(
      new UnitOfWorkFake(),
      mensagens,
      new RoteadorProcessadoresMensagemService([processador]),
      logger,
      mensageriaMetrics,
    );

    await servico.executar(JSON.stringify(envelope));
    await servico.executar(JSON.stringify(envelope));
    expect(efeitos).toHaveLength(1);
  });

  it('repete após conflito em mensagem processada sem segundo efeito', async () => {
    const efeitos: string[] = [];
    const processador: ProcessadorMensagem = {
      eventType: 'mensageria.teste-integracao.v1',
      processar: () => {
        efeitos.push('ok');
        return Promise.resolve();
      },
    };
    const hashes = new Map<string, string>();
    let tentativasRegistrar = 0;
    const mensagens: MensagemProcessadaGateway = {
      jaProcessada: (_c, eventId) => Promise.resolve(hashes.has(eventId)),
      registrar: (_c, eventId, hash) => {
        tentativasRegistrar += 1;
        if (tentativasRegistrar === 1) {
          hashes.set(eventId, hash);
          throw new ConflitoMensagemProcessadaError();
        }
        return Promise.resolve();
      },
      buscarHash: (_c, eventId) => Promise.resolve(hashes.get(eventId) ?? null),
    };
    const servico = new ProcessarMensagemEntradaService(
      new UnitOfWorkFake(),
      mensagens,
      new RoteadorProcessadoresMensagemService([processador]),
      logger,
      mensageriaMetrics,
    );

    await servico.executar(JSON.stringify(envelope));
    expect(efeitos).toHaveLength(1);
    expect(tentativasRegistrar).toBeGreaterThanOrEqual(1);
  });

  it('recusa eventId com hash divergente', async () => {
    const mensagens: MensagemProcessadaGateway = {
      jaProcessada: () => Promise.resolve(true),
      registrar: () => Promise.resolve(),
      buscarHash: () => Promise.resolve('outro-hash'),
    };
    const servico = new ProcessarMensagemEntradaService(
      new UnitOfWorkFake(),
      mensagens,
      new RoteadorProcessadoresMensagemService([]),
      logger,
      mensageriaMetrics,
    );
    await expect(servico.executar(JSON.stringify(envelope))).rejects.toThrow(
      ConteudoMensagemDivergenteError,
    );
  });
});
