import {
  correlationIdStorage,
  getCorrelationId,
  getObservabilityLogFields,
} from './correlation-id.context';

describe('correlation-id.context', () => {
  it('propaga campos no store assíncrono', () => {
    correlationIdStorage.run(
      {
        correlationId: 'c1',
        requestId: 'r1',
        eventId: 'e1',
        ordemServicoId: 'os',
        eventType: 'tipo.v1',
        rodada: 2,
        causationId: null,
      },
      () => {
        expect(getCorrelationId()).toBe('c1');
        const campos = getObservabilityLogFields();
        expect(campos.correlationId).toBe('c1');
        expect(campos.eventId).toBe('e1');
        expect(campos.rodada).toBe(2);
      },
    );
  });

  it('retorna objeto vazio sem store', () => {
    expect(getObservabilityLogFields()).toEqual({});
  });
});
