import { sanitizeObject, sanitizeString } from './log-sanitizer';

describe('log-sanitizer', () => {
  it('mascara Bearer em string', () => {
    expect(sanitizeString('Authorization Bearer abc.def.ghi')).toContain(
      'Bearer [redacted]',
    );
  });

  it('redige chaves sensíveis em objetos', () => {
    const resultado = sanitizeObject({
      token: 'secreto',
      mensagem: 'ok',
    });

    expect(resultado.token).toBe('[redacted]');
    expect(resultado.mensagem).toBe('ok');
  });

  it('sanitiza objetos aninhados', () => {
    const resultado = sanitizeObject({
      externo: {
        authorization: 'Bearer x',
        rotulo: 'visivel',
      },
    });

    expect((resultado.externo as { authorization: string }).authorization).toBe(
      '[redacted]',
    );
  });
});
