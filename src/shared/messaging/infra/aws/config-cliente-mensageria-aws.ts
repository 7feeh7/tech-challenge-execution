import type { ConfigService } from '@nestjs/config';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { resolverDeadlineOperacaoAws } from '@/shared/aws/resolver-deadline-operacao-aws';

export interface OpcoesClienteMensageriaAws {
  region: string;
  maxAttempts: number;
  requestHandler: NodeHttpHandler;
  connectionTimeoutMs: number;
  httpAttemptTimeoutMs: number;
  operationDeadlineMs: number;
}

export function criarOpcoesClienteSqs(
  config: ConfigService,
): OpcoesClienteMensageriaAws {
  const region = config.get<string>('AWS_REGION') ?? 'us-east-1';
  const connectionTimeoutMs = Number(
    config.get<string>('SQS_CONNECTION_TIMEOUT_MS') ?? '5000',
  );
  const httpAttemptTimeoutMs = Number(
    config.get<string>('SQS_HTTP_ATTEMPT_TIMEOUT_MS') ??
      config.get<string>('SQS_REQUEST_TIMEOUT_MS') ??
      '12000',
  );
  const maxAttempts = Number(config.get<string>('AWS_SDK_MAX_ATTEMPTS') ?? '3');
  const operationDeadlineMs = resolverDeadlineOperacaoAws({
    deadlineExplicito: config.get<string>('SQS_OPERATION_DEADLINE_MS'),
    httpAttemptTimeoutMs,
    maxAttempts,
  });
  const requestHandler = new NodeHttpHandler({
    connectionTimeout: connectionTimeoutMs,
    requestTimeout: httpAttemptTimeoutMs,
  });
  return {
    region,
    maxAttempts,
    requestHandler,
    connectionTimeoutMs,
    httpAttemptTimeoutMs,
    operationDeadlineMs,
  };
}
