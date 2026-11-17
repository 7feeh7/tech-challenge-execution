import { classificarErroConsumo } from './classificar-erro-consumo';
import { ConteudoMensagemDivergenteError } from './domain/mensageria.errors';
import { EnvelopeMensagemInvalidoError } from './validar-envelope';

describe('classificarErroConsumo', () => {
  it('classifica divergência como permanente', () => {
    expect(
      classificarErroConsumo(new ConteudoMensagemDivergenteError('x')),
    ).toBe('permanente');
  });

  it('classifica erro genérico como transitório', () => {
    expect(classificarErroConsumo(new Error('falha'))).toBe('transitorio');
  });

  it('classifica envelope inválido como permanente', () => {
    expect(
      classificarErroConsumo(new EnvelopeMensagemInvalidoError('inválido')),
    ).toBe('permanente');
  });
});
