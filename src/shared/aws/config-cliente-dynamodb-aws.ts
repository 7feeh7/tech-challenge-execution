import type { ConfigService } from '@nestjs/config';
import { NodeHttpHandler } from '@smithy/node-http-handler';

export interface OpcoesClienteDynamodbAws {
  region: string;
  maxAttempts: number;
  requestHandler: NodeHttpHandler;
  connectionTimeoutMs: number;
  httpAttemptTimeoutMs: number;
  operationDeadlineMs: number;
}

export function criarOpcoesClienteDynamodb(
  config: ConfigService,
): OpcoesClienteDynamodbAws {
  const region = config.get<string>('AWS_REGION') ?? 'us-east-1';
  const connectionTimeoutMs = Number(
    config.get<string>('DYNAMODB_CONNECTION_TIMEOUT_MS') ?? '5000',
  );
  const httpAttemptTimeoutMs = Number(
    config.get<string>('DYNAMODB_HTTP_ATTEMPT_TIMEOUT_MS') ?? '4000',
  );
  const maxAttempts = Number(config.get<string>('AWS_SDK_MAX_ATTEMPTS') ?? '3');
  const brutoDeadline = config.get<string>('DYNAMODB_OPERATION_DEADLINE_MS');
  const operationDeadlineMs = Number(
    brutoDeadline ?? String(httpAttemptTimeoutMs * maxAttempts),
  );
  const deadlineSeguro = Number.isFinite(operationDeadlineMs)
    ? operationDeadlineMs
    : httpAttemptTimeoutMs * maxAttempts;

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
    operationDeadlineMs: deadlineSeguro,
  };
}
