import { type DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

export interface Fato {
  eventId: string;
  eventType: string;
  causationId: string | null;
  envelope: { eventId: string; payload: Record<string, unknown> };
}

/** Todos os fatos da outbox da ordem de serviço, ordenados por tipo. */
export async function lerFatosDaOrdem(
  client: DynamoDBClient,
  tabelaOutbox: string,
  ordemServicoId: string,
): Promise<Fato[]> {
  const fatos: Fato[] = [];
  let chave: Record<string, never> | undefined;
  do {
    const resposta = await client.send(
      new ScanCommand({
        TableName: tabelaOutbox,
        ExclusiveStartKey: chave,
      }),
    );
    for (const item of resposta.Items ?? []) {
      const registro = unmarshall(item) as unknown as Fato;
      const envelope = registro.envelope as { ordemServicoId?: string };
      if (envelope.ordemServicoId === ordemServicoId) fatos.push(registro);
    }
    chave = resposta.LastEvaluatedKey as Record<string, never> | undefined;
  } while (chave);
  return fatos.sort((a, b) => (a.eventType < b.eventType ? -1 : 1));
}

export const tiposDosFatos = (fatos: Fato[]): string[] =>
  fatos.map((f) => f.eventType);

export const fatosDoTipo = (fatos: Fato[], tipo: string): Fato[] =>
  fatos.filter((f) => f.eventType === tipo);
