import { normalizarChavePublica } from './normalizar-chave-publica';

describe('normalizarChavePublica', () => {
  it('converte \n literal em quebra de linha', () => {
    expect(normalizarChavePublica('-----BEGIN-----\nabc\n-----END-----')).toBe(
      '-----BEGIN-----\nabc\n-----END-----',
    );
  });

  it('mantém chave que já tem quebras de linha', () => {
    expect(normalizarChavePublica('a\nb')).toBe('a\nb');
  });
});
