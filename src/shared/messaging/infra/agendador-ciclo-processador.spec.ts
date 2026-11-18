import { Logger } from '@nestjs/common';
import { AgendadorCicloProcessador } from './agendador-ciclo-processador';

describe('AgendadorCicloProcessador', () => {
  const logger = new Logger('teste');

  it('não inicia ciclo sobreposto enquanto o anterior está em andamento', async () => {
    let execucoes = 0;
    let liberar!: () => void;
    const trava = new Promise<void>((resolve) => {
      liberar = resolve;
    });

    const agendador = new AgendadorCicloProcessador(
      10,
      async () => {
        execucoes += 1;
        await trava;
      },
      logger,
      'falha',
    );
    agendador.iniciar();
    await new Promise((r) => setTimeout(r, 20));
    expect(execucoes).toBe(1);
    expect(agendador.cicloAtivo).toBe(true);
    liberar();
    await new Promise((r) => setTimeout(r, 30));
    await agendador.parar();
    expect(execucoes).toBeGreaterThanOrEqual(1);
  });

  it('parar aguarda o ciclo em andamento e não agenda outro', async () => {
    let concluiu = false;
    const agendador = new AgendadorCicloProcessador(
      50,
      async () => {
        await new Promise((r) => setTimeout(r, 80));
        concluiu = true;
      },
      logger,
      'falha',
    );
    agendador.iniciar();
    await new Promise((r) => setTimeout(r, 10));
    await agendador.parar();
    expect(concluiu).toBe(true);
  });
});
