import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  ConflitoMensagemProcessadaError,
  ehConflitoMensagemProcessada,
  mapearErroTransacaoDynamodb,
} from './tratar-erro-dynamodb-transacao';

describe('tratar-erro-dynamodb-transacao', () => {
  it('identifica conflito de mensagem processada', () => {
    const erro = new ConflitoMensagemProcessadaError();
    expect(ehConflitoMensagemProcessada(erro)).toBe(true);
  });

  it('identifica conflito quando CancellationReasons traz eventId', () => {
    expect(() =>
      mapearErroTransacaoDynamodb(
        new TransactionCanceledException({
          message: 'cancelada',
          CancellationReasons: [
            {
              Code: 'ConditionalCheckFailed',
              Item: { eventId: { S: 'e1' } },
            },
          ],
        }),
      ),
    ).toThrow(ConflitoMensagemProcessadaError);
  });

  it('mapeia TransactionCanceled para conflito', () => {
    expect(() =>
      mapearErroTransacaoDynamodb(
        new TransactionCanceledException({
          message: 'cancelada',
          CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
        }),
      ),
    ).toThrow();
  });

  it('mapeia cancelamento sem falha condicional', () => {
    expect(() =>
      mapearErroTransacaoDynamodb(
        new TransactionCanceledException({
          message: 'transação cancelada sem condição',
          CancellationReasons: [{ Code: 'None' }],
        }),
      ),
    ).toThrow();
  });

  it('propaga erro que não é transação cancelada', () => {
    const erro = new Error('falha inesperada');
    expect(() => mapearErroTransacaoDynamodb(erro)).toThrow(erro);
  });
});
