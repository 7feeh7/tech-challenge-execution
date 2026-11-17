import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DynamoDbClientProvider {
  readonly client: DynamoDBClient;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('DYNAMODB_ENDPOINT');
    this.client = new DynamoDBClient({
      region: config.get<string>('AWS_REGION') ?? 'us-east-1',
      ...(endpoint
        ? {
            endpoint,
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {}),
    });
  }
}
