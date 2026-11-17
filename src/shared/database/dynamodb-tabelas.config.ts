import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DynamoDbTabelasConfig {
  readonly tarefas: string;
  readonly outbox: string;
  readonly mensagensProcessadas: string;
}

@Injectable()
export class DynamoDbTabelasService implements DynamoDbTabelasConfig {
  readonly tarefas: string;
  readonly outbox: string;
  readonly mensagensProcessadas: string;

  constructor(config: ConfigService) {
    this.tarefas = config.getOrThrow<string>('DYNAMODB_TAREFAS_TABLE');
    this.outbox = config.getOrThrow<string>('DYNAMODB_OUTBOX_TABLE');
    this.mensagensProcessadas = config.getOrThrow<string>(
      'DYNAMODB_MENSAGENS_PROCESSADAS_TABLE',
    );
  }
}
