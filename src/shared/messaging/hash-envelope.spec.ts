import { hashEnvelope } from './hash-envelope';

describe('hashEnvelope', () => {
  it('retorna hash estável para o mesmo conteúdo', () => {
    const envelope = { a: 1 };
    expect(hashEnvelope(envelope)).toBe(hashEnvelope(envelope));
  });
});
