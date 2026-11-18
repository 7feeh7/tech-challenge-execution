import { JsonLoggerService } from './json-logger.service';

describe('Privacidade em logs estruturados', () => {
  const logger = new JsonLoggerService();
  let saida = '';

  beforeEach(() => {
    saida = '';
    jest.spyOn(console, 'log').mockImplementation((linha) => {
      saida = String(linha);
    });
    jest.spyOn(console, 'error').mockImplementation((linha) => {
      saida = String(linha);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('não expõe justificativa, motivo, responsável ou token de serviço', () => {
    logger.logWithMeta(
      'info',
      'operação',
      {
        justificativaDivergencia: 'segredo-justificativa',
        motivo: 'segredo-motivo',
        responsavelId: 'mec-secreto',
        sub: 'jwt-sub-secreto',
        OS_SERVICE_TOKEN: 'token-os',
        authorization: 'Bearer jwt.secreto',
        correlationId: 'corr-visivel',
        eventId: 'evt-visivel',
      },
      'Tarefas',
    );

    const json = JSON.parse(saida) as Record<string, unknown>;
    expect(json.correlationId).toBe('corr-visivel');
    expect(json.eventId).toBe('evt-visivel');
    expect(JSON.stringify(json)).not.toContain('segredo-justificativa');
    expect(JSON.stringify(json)).not.toContain('segredo-motivo');
    expect(JSON.stringify(json)).not.toContain('mec-secreto');
    expect(JSON.stringify(json)).not.toContain('jwt-sub-secreto');
    expect(JSON.stringify(json)).not.toContain('token-os');
    expect(JSON.stringify(json)).not.toContain('jwt.secreto');
  });
});
