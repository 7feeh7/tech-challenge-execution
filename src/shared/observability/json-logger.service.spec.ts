import { JsonLoggerService } from './json-logger.service';

describe('JsonLoggerService', () => {
  let logger: JsonLoggerService;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new JsonLoggerService();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('emite log JSON com nível info', () => {
    logger.log('mensagem de teste', 'Contexto');

    const linha = consoleSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(linha) as {
      level: string;
      message: string;
      context?: string;
    };

    expect(entry.level).toBe('info');
    expect(entry.message).toBe('mensagem de teste');
    expect(entry.context).toBe('Contexto');
  });

  it('emite warn, debug, error e verbose', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    logger.warn('aviso');
    logger.debug('debug');
    logger.error('erro', 'stack');
    logger.verbose('verboso');

    expect(warnSpy).toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    debugSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('emite log estruturado com meta via logWithMeta', () => {
    logger.logWithMeta('info', 'mensagem.consumo.processada', {
      eventId: 'e1',
    });
    const linha = consoleSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(linha) as { message: string; eventId?: string };
    expect(entry.message).toBe('mensagem.consumo.processada');
    expect(entry.eventId).toBe('e1');
  });

  it('emite logWithMeta em warn e error', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    logger.logWithMeta('warn', 'alerta', {});
    logger.logWithMeta('error', 'falha', {});
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
