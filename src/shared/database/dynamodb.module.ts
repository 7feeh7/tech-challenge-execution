import { Global, Module } from '@nestjs/common';
import { DynamoDbClientProvider } from './dynamodb-client.provider';
import { DynamoDbTabelasService } from './dynamodb-tabelas.config';
import { DynamoDbUnitOfWork } from './dynamodb-unit-of-work';
import { UNIT_OF_WORK } from './unit-of-work.port';

@Global()
@Module({
  providers: [
    DynamoDbClientProvider,
    DynamoDbTabelasService,
    DynamoDbUnitOfWork,
    { provide: UNIT_OF_WORK, useExisting: DynamoDbUnitOfWork },
  ],
  exports: [
    DynamoDbClientProvider,
    DynamoDbTabelasService,
    DynamoDbUnitOfWork,
    UNIT_OF_WORK,
  ],
})
export class DynamoDbModule {}
