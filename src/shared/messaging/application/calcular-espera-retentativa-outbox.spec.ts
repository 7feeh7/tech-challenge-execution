import {
  calcularBloqueadoAteRetentativaOutbox,
  calcularEsperaRetentativaOutbox,
} from './calcular-espera-retentativa-outbox';

describe('calcularEsperaRetentativaOutbox', () => {
  it('retorna zero para tentativas inválidas', () => {
    expect(calcularEsperaRetentativaOutbox(0, 1000, 5000)).toBe(0);
    expect(calcularEsperaRetentativaOutbox(1, 0, 5000)).toBe(0);
  });

  it('aplica teto na espera exponencial', () => {
    expect(calcularEsperaRetentativaOutbox(5, 1000, 5000)).toBe(5000);
  });

  it('calcula bloqueadoAte a partir da tentativa', () => {
    const base = new Date('2026-01-01T00:00:00.000Z');
    const resultado = calcularBloqueadoAteRetentativaOutbox(
      2,
      1000,
      5000,
      base,
    );
    expect(resultado.getTime()).toBe(base.getTime() + 2000);
  });
});
