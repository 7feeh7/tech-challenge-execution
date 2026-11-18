/**
 * Barreira de teste para alinhar duas transações DynamoDB no mesmo instante.
 * Sem alterar o código de produção.
 */
export interface BarreiraTransacaoDynamodb {
  aguardarNaTransacao: () => Promise<void>;
  liberar: () => void;
}

export function criarBarreiraDupla(): BarreiraTransacaoDynamodb {
  let participantes = 0;
  let resolver!: () => void;
  const porta = new Promise<void>((resolve) => {
    resolver = resolve;
  });

  return {
    async aguardarNaTransacao(): Promise<void> {
      participantes += 1;
      if (participantes >= 2) {
        resolver();
      }
      await porta;
    },
    liberar(): void {
      if (participantes < 2) {
        resolver();
      }
    },
  };
}
