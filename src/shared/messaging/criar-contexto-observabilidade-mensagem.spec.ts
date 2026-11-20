import { criarContextoObservabilidadeMensagem } from './criar-contexto-observabilidade-mensagem';

describe('criarContextoObservabilidadeMensagem', () => {
  it('mapeia envelope para contexto de observabilidade', () => {
    const contexto = criarContextoObservabilidadeMensagem({
      eventId: 'e',
      eventType: 'tipo.v1',
      version: 1,
      occurredAt: 't',
      source: 'os',
      correlationId: 'c',
      causationId: 'causa',
      ordemServicoId: 'os',
      rodada: 2,
      payload: {},
    });
    expect(contexto.correlationId).toBe('c');
    expect(contexto.rodada).toBe(2);
    expect(contexto.causationId).toBe('causa');
  });
});
