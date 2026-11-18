import { ConfigService } from '@nestjs/config';
import { ErroMensagemTransitoria } from '../../domain/mensageria.errors';
import { criarMessagingMetricsFake } from '../../testing/observabilidade-mensageria.test-doubles';
import { EnvelopeMensagemInvalidoError } from '../../validar-envelope';
import { ConsumidorFilaExecutionService } from './consumidor-fila-execution.service';

describe('ConsumidorFilaExecutionService', () => {
  it('não confirma erro transitório', async () => {
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_EXECUTION_IN_URL') return 'https://sqs.local/in';
        return undefined;
      }),
    } as unknown as ConfigService;
    const confirmar = jest.fn();
    const service = new ConsumidorFilaExecutionService(
      config,
      {
        receber: jest.fn(),
        confirmar,
        enviar: jest.fn(),
        enviarCorpoBruto: jest.fn(),
      },
      {
        executar: jest
          .fn()
          .mockRejectedValue(new ErroMensagemTransitoria('indisponível')),
      } as never,
      criarMessagingMetricsFake(),
    );
    await service.processarUma('{}', 'rh-t');
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('processa lote recebido do poller', async () => {
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        if (k === 'SQS_EXECUTION_IN_URL') return 'https://sqs.local/in';
        return '1';
      }),
    } as unknown as ConfigService;
    const service = new ConsumidorFilaExecutionService(
      config,
      {
        receber: jest
          .fn()
          .mockResolvedValue([{ corpo: '{}', receiptHandle: 'rh' }]),
        confirmar: jest.fn(),
        enviar: jest.fn(),
        enviarCorpoBruto: jest.fn(),
      },
      { executar: jest.fn().mockResolvedValue(undefined) } as never,
      criarMessagingMetricsFake(),
    );
    await service.poller();
  });

  it('inicia poller quando habilitado e encerra com segurança', async () => {
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        if (k === 'SQS_EXECUTION_IN_URL') return 'https://sqs.local/in';
        return '1';
      }),
    } as unknown as ConfigService;
    const service = new ConsumidorFilaExecutionService(
      config,
      {
        receber: jest.fn().mockResolvedValue([]),
        confirmar: jest.fn(),
        enviar: jest.fn(),
        enviarCorpoBruto: jest.fn(),
      },
      { executar: jest.fn() } as never,
      criarMessagingMetricsFake(),
    );
    service.onModuleInit();
    await service.onModuleDestroy();
  });

  it('não inicia poller quando desabilitado', () => {
    const config = {
      get: jest.fn((k: string) =>
        k === 'SQS_CONSUMER_HABILITADO' ? 'false' : undefined,
      ),
    } as unknown as ConfigService;
    const service = new ConsumidorFilaExecutionService(
      config,
      {
        receber: jest.fn(),
        confirmar: jest.fn(),
        enviar: jest.fn(),
        enviarCorpoBruto: jest.fn(),
      },
      { executar: jest.fn() } as never,
      criarMessagingMetricsFake(),
    );
    service.onModuleInit();
    expect((service as { agendador?: unknown }).agendador).toBeUndefined();
  });

  it('confirma mensagem após processamento bem-sucedido', async () => {
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        if (k === 'SQS_EXECUTION_IN_URL') return 'https://sqs.local/in';
        return '1';
      }),
    } as unknown as ConfigService;
    const confirmar = jest.fn().mockResolvedValue(undefined);
    const service = new ConsumidorFilaExecutionService(
      config,
      {
        receber: jest.fn(),
        confirmar,
        enviar: jest.fn(),
        enviarCorpoBruto: jest.fn(),
      },
      { executar: jest.fn().mockResolvedValue(undefined) } as never,
      criarMessagingMetricsFake(),
    );
    await service.processarUma('{}', 'rh-1');
    expect(confirmar).toHaveBeenCalledWith('https://sqs.local/in', 'rh-1');
  });

  it('encaminha erro permanente à DLQ e confirma', async () => {
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        if (k === 'SQS_EXECUTION_IN_URL') return 'https://sqs.local/in';
        if (k === 'SQS_EXECUTION_IN_DLQ_URL') return 'https://sqs.local/dlq';
        return undefined;
      }),
    } as unknown as ConfigService;
    const confirmar = jest.fn().mockResolvedValue(undefined);
    const enviarCorpoBruto = jest.fn().mockResolvedValue(undefined);
    const service = new ConsumidorFilaExecutionService(
      config,
      {
        receber: jest.fn(),
        confirmar,
        enviar: jest.fn(),
        enviarCorpoBruto,
      },
      {
        executar: jest
          .fn()
          .mockRejectedValue(new EnvelopeMensagemInvalidoError('inválido')),
      } as never,
      criarMessagingMetricsFake(),
    );
    await service.processarUma('{"eventId":"x"}', 'rh-3');
    expect(enviarCorpoBruto).toHaveBeenCalled();
    expect(confirmar).toHaveBeenCalled();
  });

  it('sinaliza abortamento ao destruir o módulo', async () => {
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        if (k === 'SQS_EXECUTION_IN_URL') return 'https://sqs.local/in';
        return '1';
      }),
    } as unknown as ConfigService;
    const service = new ConsumidorFilaExecutionService(
      config,
      {
        receber: jest.fn().mockResolvedValue([]),
        confirmar: jest.fn(),
        enviar: jest.fn(),
        enviarCorpoBruto: jest.fn(),
      },
      { executar: jest.fn() } as never,
      criarMessagingMetricsFake(),
    );
    service.onModuleInit();
    await service.onModuleDestroy();
    const sinal = (service as unknown as { sinalAbortamento: AbortController })
      .sinalAbortamento.signal;
    expect(sinal.aborted).toBe(true);
  });

  it('não agenda novo ciclo após parar o agendador', async () => {
    let ciclos = 0;
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        if (k === 'SQS_EXECUTION_IN_URL') return 'https://sqs.local/in';
        if (k === 'SQS_CONSUMER_INTERVAL_MS') return '5';
        return '1';
      }),
    } as unknown as ConfigService;
    const service = new ConsumidorFilaExecutionService(
      config,
      {
        receber: jest.fn().mockImplementation(async () => {
          ciclos += 1;
          return [];
        }),
        confirmar: jest.fn(),
        enviar: jest.fn(),
        enviarCorpoBruto: jest.fn(),
      },
      { executar: jest.fn().mockResolvedValue(undefined) } as never,
      criarMessagingMetricsFake(),
    );
    service.onModuleInit();
    await new Promise((r) => setTimeout(r, 25));
    const antes = ciclos;
    await service.onModuleDestroy();
    await new Promise((r) => setTimeout(r, 40));
    expect(ciclos).toBe(antes);
  });

  it('não confirma quando encaminhamento à DLQ falha', async () => {
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        if (k === 'SQS_EXECUTION_IN_URL') return 'https://sqs.local/in';
        return undefined;
      }),
    } as unknown as ConfigService;
    const confirmar = jest.fn();
    const service = new ConsumidorFilaExecutionService(
      config,
      {
        receber: jest.fn(),
        confirmar,
        enviar: jest.fn(),
        enviarCorpoBruto: jest.fn(),
      },
      {
        executar: jest
          .fn()
          .mockRejectedValue(new EnvelopeMensagemInvalidoError('inválido')),
      } as never,
      criarMessagingMetricsFake(),
    );
    await service.processarUma('{invalido', 'rh-2');
    expect(confirmar).not.toHaveBeenCalled();
  });
});
