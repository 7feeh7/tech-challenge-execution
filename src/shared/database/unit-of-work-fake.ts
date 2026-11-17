import type { ContextoTransacao, UnitOfWork } from './unit-of-work.port';
import { ContextoTransacaoMarca, UNIT_OF_WORK } from './unit-of-work.port';

export class ContextoTransacaoFake implements ContextoTransacao {
  readonly [ContextoTransacaoMarca] = undefined;

  readonly mensagensProcessadas = new Map<string, string>();
  readonly outbox: unknown[] = [];
  readonly efeitos: unknown[] = [];
  falharAoConfirmar = false;
}

export class UnitOfWorkFake implements UnitOfWork {
  readonly contextos: ContextoTransacaoFake[] = [];
  profundidade = 0;
  executarChamadas = 0;

  async executar<T>(
    trabalho: (contexto: ContextoTransacao) => Promise<T>,
  ): Promise<T> {
    if (this.profundidade > 0) {
      throw new Error('Transação aninhada');
    }
    this.executarChamadas += 1;
    this.profundidade += 1;
    const contexto = new ContextoTransacaoFake();
    try {
      const resultado = await trabalho(contexto);
      if (contexto.falharAoConfirmar) {
        throw new Error('falha simulada no commit');
      }
      this.contextos.push(contexto);
      return resultado;
    } finally {
      this.profundidade -= 1;
    }
  }
}

export const UNIT_OF_WORK_FAKE_PROVIDER = {
  provide: UNIT_OF_WORK,
  useClass: UnitOfWorkFake,
};
