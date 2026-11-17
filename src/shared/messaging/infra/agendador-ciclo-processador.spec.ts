import { Logger } from '@nestjs/common';
import { AgendadorCicloProcessador } from './agendador-ciclo-processador';

describe('AgendadorCicloProcessador', () => {
  it('não agenda novo ciclo enquanto um está ativo', async () => {
    let execucoes = 0;
    const logger = new Logger('teste');
    const agendador = new AgendadorCicloProcessador(
      50,
      async () => {
        execucoes += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
      logger,
      'falha',
    );
    agendador.iniciar();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(agendador.cicloAtivo).toBe(true);
    await agendador.parar();
    expect(execucoes).toBe(1);
  });
});
