import { ConfigService } from '@nestjs/config';
import { DESTINO_FILA_OS } from '../../envelope';
import {
  criarJsonLoggerMensageriaFake,
  criarMessagingMetricsFake,
} from '../../testing/observabilidade-mensageria.test-doubles';
import type { DynamoDbOutboxRepositorio } from '../persistence/dynamodb-outbox-repositorio';
import { PublicadorOutboxService } from './publicador-outbox.service';

describe('PublicadorOutboxService', () => {
  it('agenda publicação quando habilitado com true', () => {
    const config = {
      get: jest.fn((k: string) =>
        k === 'OUTBOX_PUBLISHER_HABILITADO' ? 'true' : '1000',
      ),
      getOrThrow: jest.fn(),
    } as unknown as ConfigService;
    const service = new PublicadorOutboxService(
      config,
      { listarCandidatasPendentes: jest.fn() } as never,
      { enviar: jest.fn() } as never,
      criarJsonLoggerMensageriaFake(),
      criarMessagingMetricsFake(),
    );
    service.onModuleInit();
    expect((service as { agendador?: unknown }).agendador).toBeDefined();
    return service.onModuleDestroy();
  });

  it('não agenda publicação quando desabilitado', () => {
    const config = {
      get: jest.fn((k: string) =>
        k === 'OUTBOX_PUBLISHER_HABILITADO' ? 'false' : undefined,
      ),
      getOrThrow: jest.fn(),
    } as unknown as ConfigService;
    const service = new PublicadorOutboxService(
      config,
      { listarCandidatasPendentes: jest.fn() } as never,
      { enviar: jest.fn() } as never,
      criarJsonLoggerMensageriaFake(),
      criarMessagingMetricsFake(),
    );
    service.onModuleInit();
    expect((service as { agendador?: unknown }).agendador).toBeUndefined();
  });

  it('publica reivindicação e confirma envio', async () => {
    const fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    const mensagem = {
      eventId: 'e1',
      destino: DESTINO_FILA_OS,
      envelope: { eventId: 'e1', correlationId: 'c' },
      correlationId: 'c',
      tokenReivindicacao: 'token-1',
      tentativas: 0,
    };
    const repo: Partial<DynamoDbOutboxRepositorio> = {
      listarCandidatasPendentes: jest.fn().mockResolvedValue(['e1']),
      reivindicar: jest
        .fn()
        .mockImplementation(async (_eventId: string, token: string) => ({
          ...mensagem,
          tokenReivindicacao: token,
        })),
      confirmarEnvio: jest.fn().mockResolvedValue(true),
      contarPendentes: jest.fn().mockResolvedValue(0),
    };
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'OUTBOX_PUBLISHER_HABILITADO') return 'true';
        if (k === 'OUTBOX_REIVINDICACAO_MS') return '30000';
        return '1';
      }),
      getOrThrow: jest.fn().mockReturnValue('https://sqs/os-in'),
    } as unknown as ConfigService;

    const service = new PublicadorOutboxService(
      config,
      repo as DynamoDbOutboxRepositorio,
      fila as never,
      criarJsonLoggerMensageriaFake(),
      criarMessagingMetricsFake(),
    );
    await service.publicarLote();
    expect(fila.enviar).toHaveBeenCalled();
    expect(repo.confirmarEnvio).toHaveBeenCalledWith('e1', expect.any(String));
  });

  it('libera outbox após destino desconhecido na publicação', async () => {
    const fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    const liberar = jest.fn().mockResolvedValue(true);
    const service = new PublicadorOutboxService(
      {
        get: jest.fn(() => '1000'),
        getOrThrow: jest.fn().mockReturnValue('https://sqs/os-in'),
      } as unknown as ConfigService,
      { liberarAposFalha: liberar } as never,
      fila as never,
      criarJsonLoggerMensageriaFake(),
      criarMessagingMetricsFake(),
    );
    await service.publicarMensagemReivindicada({
      eventId: 'e4',
      destino: 'fila-desconhecida',
      envelope: {},
      correlationId: 'c',
      tokenReivindicacao: 't',
      tentativas: 0,
    });
    expect(fila.enviar).not.toHaveBeenCalled();
    expect(liberar).toHaveBeenCalledWith('e4', 't', expect.any(String), 1);
  });

  it('ignora mensagem reivindicada sem token', async () => {
    const service = new PublicadorOutboxService(
      { get: jest.fn(), getOrThrow: jest.fn() } as unknown as ConfigService,
      {} as DynamoDbOutboxRepositorio,
      { enviar: jest.fn() } as never,
      criarJsonLoggerMensageriaFake(),
      criarMessagingMetricsFake(),
    );
    await service.publicarMensagemReivindicada({
      eventId: 'e',
      destino: DESTINO_FILA_OS,
      envelope: {},
      correlationId: 'c',
      tokenReivindicacao: null,
      tentativas: 0,
    });
  });

  it('registra fencing quando confirmação falha', async () => {
    const fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    const logger = criarJsonLoggerMensageriaFake();
    const mensagem = {
      eventId: 'e3',
      destino: DESTINO_FILA_OS,
      envelope: {},
      correlationId: 'c',
      tokenReivindicacao: 'token-3',
      tentativas: 0,
    };
    const repo: Partial<DynamoDbOutboxRepositorio> = {
      confirmarEnvio: jest.fn().mockResolvedValue(false),
    };
    const config = {
      get: jest.fn(() => '1000'),
      getOrThrow: jest.fn().mockReturnValue('https://sqs/os-in'),
    } as unknown as ConfigService;
    const service = new PublicadorOutboxService(
      config,
      repo as DynamoDbOutboxRepositorio,
      fila as never,
      logger,
      criarMessagingMetricsFake(),
    );
    await service.publicarMensagemReivindicada(mensagem);
    expect(logger.logWithMeta).toHaveBeenCalledWith(
      'warn',
      'outbox.publicacao.fencing',
      expect.any(Object),
      'OutboxPublicador',
    );
  });

  it('registra fencing quando liberação perde posse', async () => {
    const fila = {
      enviar: jest.fn().mockRejectedValue(new Error('sqs indisponível')),
    };
    const liberar = jest.fn().mockResolvedValue(false);
    const logger = criarJsonLoggerMensageriaFake();
    const mensagem = {
      eventId: 'e-fence',
      destino: DESTINO_FILA_OS,
      envelope: { eventId: 'e-fence' },
      correlationId: 'c',
      tokenReivindicacao: 'token-f',
      tentativas: 0,
    };
    const service = new PublicadorOutboxService(
      {
        get: jest.fn(() => '1000'),
        getOrThrow: jest.fn().mockReturnValue('https://sqs/os-in'),
      } as unknown as ConfigService,
      { liberarAposFalha: liberar } as never,
      fila as never,
      logger,
      criarMessagingMetricsFake(),
    );
    await service.publicarMensagemReivindicada(mensagem);
    expect(logger.logWithMeta).toHaveBeenCalledWith(
      'warn',
      'outbox.liberacao.fencing',
      expect.objectContaining({ eventId: 'e-fence' }),
      'OutboxPublicador',
    );
  });

  it('libera registro após falha de publicação', async () => {
    const fila = {
      enviar: jest.fn().mockRejectedValue(new Error('sqs indisponível')),
    };
    const mensagem = {
      eventId: 'e2',
      destino: DESTINO_FILA_OS,
      envelope: { eventId: 'e2' },
      correlationId: 'c',
      tokenReivindicacao: 'token-2',
      tentativas: 0,
    };
    const liberar = jest.fn().mockResolvedValue(true);
    const repo: Partial<DynamoDbOutboxRepositorio> = {
      listarCandidatasPendentes: jest.fn().mockResolvedValue(['e2']),
      reivindicar: jest
        .fn()
        .mockImplementation(async (_eventId: string, token: string) => ({
          ...mensagem,
          tokenReivindicacao: token,
        })),
      liberarAposFalha: liberar,
      contarPendentes: jest.fn().mockResolvedValue(1),
    };
    const config = {
      get: jest.fn(() => '1000'),
      getOrThrow: jest.fn().mockReturnValue('https://sqs/os-in'),
    } as unknown as ConfigService;

    const service = new PublicadorOutboxService(
      config,
      repo as DynamoDbOutboxRepositorio,
      fila as never,
      criarJsonLoggerMensageriaFake(),
      criarMessagingMetricsFake(),
    );
    await service.publicarMensagemReivindicada(mensagem);
    expect(liberar).toHaveBeenCalled();
  });
});
