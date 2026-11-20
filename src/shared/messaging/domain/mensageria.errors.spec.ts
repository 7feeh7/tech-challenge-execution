import {
  ConteudoMensagemDivergenteError,
  ErroMensagemPermanente,
  ErroMensagemTransitoria,
} from './mensageria.errors';

describe('mensageria.errors', () => {
  it('expõe mensagens de domínio para consumo', () => {
    expect(new ConteudoMensagemDivergenteError('e1').message).toContain('e1');
    expect(new ErroMensagemPermanente('falha').message).toBe('falha');
    expect(new ErroMensagemTransitoria('transiente').name).toBe(
      'ErroMensagemTransitoria',
    );
  });
});
