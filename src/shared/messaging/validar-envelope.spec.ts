import {
  EnvelopeMensagemInvalidoError,
  validarEnvelopeBase,
} from './validar-envelope';

describe('validarEnvelopeBase', () => {
  it('aceita envelope mínimo válido', () => {
    expect(() =>
      validarEnvelopeBase({
        eventId: '1',
        eventType: 'x.v1',
        version: 1,
        occurredAt: '2026-01-01T00:00:00.000Z',
        source: 'os',
        correlationId: '2',
        ordemServicoId: '3',
        rodada: 1,
        payload: {},
      }),
    ).not.toThrow();
  });

  it('recusa envelope sem eventId', () => {
    expect(() => validarEnvelopeBase({})).toThrow(
      EnvelopeMensagemInvalidoError,
    );
  });

  it('recusa envelope nulo', () => {
    expect(() => validarEnvelopeBase(null)).toThrow(
      EnvelopeMensagemInvalidoError,
    );
  });

  it('recusa versão não numérica', () => {
    expect(() =>
      validarEnvelopeBase({
        eventId: '1',
        eventType: 'x.v1',
        version: '1',
        occurredAt: 't',
        source: 'os',
        correlationId: '2',
        ordemServicoId: '3',
        rodada: 1,
        payload: {},
      }),
    ).toThrow(EnvelopeMensagemInvalidoError);
  });

  it('recusa versão inválida', () => {
    expect(() =>
      validarEnvelopeBase({
        eventId: '1',
        eventType: 'x.v1',
        version: 0,
        occurredAt: 't',
        source: 'os',
        correlationId: '2',
        ordemServicoId: '3',
        rodada: 1,
        payload: {},
      }),
    ).toThrow(EnvelopeMensagemInvalidoError);
  });
});
