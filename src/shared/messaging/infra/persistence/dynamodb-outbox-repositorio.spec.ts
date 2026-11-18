import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import { DynamoDbTabelasService } from '@/shared/database/dynamodb-tabelas.config';
import { DynamoDbOutboxRepositorio } from './dynamodb-outbox-repositorio';

describe('DynamoDbOutboxRepositorio', () => {
  it('lista candidatas e confirma envio com sucesso', async () => {
    const provider = {
      enviar: jest
          .fn()
          .mockResolvedValueOnce({
            Items: [
              {
                eventId: { S: 'e1' },
                criadoEm: { S: '2026-01-01T00:00:00.000Z' },
              },
            ],
          })
          .mockResolvedValueOnce({
            Attributes: {
              eventId: { S: 'e1' },
              destino: { S: 'os-in' },
              envelope: { S: '{}' },
              correlationId: { S: 'c' },
              tokenReivindicacao: { S: 't' },
              tentativas: { N: '0' },
            },
          })
          .mockResolvedValue({}),
    } as unknown as DynamoDbClientProvider;
    const tabelas = { outbox: 'outbox' } as DynamoDbTabelasService;
    const repo = new DynamoDbOutboxRepositorio(provider, tabelas);
    const candidatas = await repo.listarCandidatasPendentes(5);
    expect(candidatas).toContain('e1');
    const reivindicada = await repo.reivindicar(
      'e1',
      'token',
      new Date(Date.now() + 60_000).toISOString(),
    );
    expect(reivindicada?.eventId).toBe('e1');
    await expect(repo.confirmarEnvio('e1', 't')).resolves.toBe(true);
    await repo.liberarAposFalha('e1', 't', new Date().toISOString(), 2);
    await expect(repo.contarPendentes()).resolves.toBeGreaterThanOrEqual(0);
  });

  it('retorna null quando reivindicação perde condição', async () => {
    const provider = {
      enviar: jest.fn().mockRejectedValue({
        name: 'ConditionalCheckFailedException',
      }),
    } as unknown as DynamoDbClientProvider;
    const tabelas = { outbox: 'outbox' } as DynamoDbTabelasService;
    const repo = new DynamoDbOutboxRepositorio(provider, tabelas);
    await expect(
      repo.reivindicar('e1', 'token', new Date().toISOString()),
    ).resolves.toBeNull();
  });

  it('propaga erro inesperado na reivindicação', async () => {
    const provider = {
      enviar: jest.fn().mockRejectedValue(new Error('dynamodb offline')),
    } as unknown as DynamoDbClientProvider;
    const tabelas = { outbox: 'outbox' } as DynamoDbTabelasService;
    const repo = new DynamoDbOutboxRepositorio(provider, tabelas);
    await expect(
      repo.reivindicar('e1', 'token', new Date().toISOString()),
    ).rejects.toThrow('dynamodb offline');
  });

  it('retorna false ao confirmar com token inválido', async () => {
    const provider = {
      enviar: jest.fn().mockRejectedValue({
        name: 'ConditionalCheckFailedException',
      }),
    } as unknown as DynamoDbClientProvider;
    const tabelas = { outbox: 'outbox' } as DynamoDbTabelasService;
    const repo = new DynamoDbOutboxRepositorio(provider, tabelas);
    await expect(repo.confirmarEnvio('e1', 'token')).resolves.toBe(false);
  });
});
