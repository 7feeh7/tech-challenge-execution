import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Identifica a operação concorrente no código de teste: o rótulo viaja pelo fluxo
 * assíncrono da operação sem tocar o código de produção.
 */
const rotuloOperacao = new AsyncLocalStorage<string>();

export function comRotulo<T>(
  rotulo: string,
  trabalho: () => Promise<T>,
): Promise<T> {
  return rotuloOperacao.run(rotulo, trabalho);
}

export function rotuloAtual(): string | undefined {
  return rotuloOperacao.getStore();
}

interface Sinal {
  promessa: Promise<void>;
  resolver: () => void;
}

function criarSinal(): Sinal {
  let resolver!: () => void;
  const promessa = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

/**
 * Barreira ordenada em `TransactWriteItems`: as duas operações chegam à escrita com a
 * leitura que fizeram antes de qualquer escrita; só então a designada como primeira
 * escreve, e a segunda escreve depois que o envio da primeira terminou.
 * Só o primeiro `TransactWriteItems` de cada rótulo fica retido: retentativas passam.
 */
export class BarreiraOrdenada {
  private readonly retidos = new Set<string>();
  private readonly chegadas = new Map<string, Sinal>();
  private readonly liberacoes = new Map<string, Sinal>();
  private readonly enviosConcluidos = new Map<string, Sinal>();

  constructor(
    readonly primeiro: string,
    readonly segundo: string,
  ) {
    for (const rotulo of [primeiro, segundo]) {
      this.chegadas.set(rotulo, criarSinal());
      this.liberacoes.set(rotulo, criarSinal());
      this.enviosConcluidos.set(rotulo, criarSinal());
    }
  }

  async passar<T>(enviar: () => Promise<T>): Promise<T> {
    const rotulo = rotuloAtual();
    if (rotulo === undefined || !this.chegadas.has(rotulo)) return enviar();
    if (this.retidos.has(rotulo)) return enviar();
    this.retidos.add(rotulo);

    this.sinal(this.chegadas, rotulo).resolver();
    await this.sinal(this.liberacoes, rotulo).promessa;
    try {
      return await enviar();
    } finally {
      this.sinal(this.enviosConcluidos, rotulo).resolver();
    }
  }

  /**
   * Rejeita se alguma operação terminar antes de as duas chegarem à barreira (por exemplo,
   * por não ter reconhecido o rótulo ou por não escrever).
   */
  async conduzir(operacoes: Promise<unknown>[]): Promise<void> {
    const terminouSemChegar = () => {
      throw new Error(
        'Uma operação terminou sem alcançar o TransactWriteItems da barreira.',
      );
    };
    const algumaTerminou = Promise.race(
      operacoes.map((operacao) =>
        operacao.then(terminouSemChegar, terminouSemChegar),
      ),
    );
    algumaTerminou.catch(() => undefined);
    await Promise.race([
      Promise.all([
        this.sinal(this.chegadas, this.primeiro).promessa,
        this.sinal(this.chegadas, this.segundo).promessa,
      ]),
      algumaTerminou,
    ]);

    this.sinal(this.liberacoes, this.primeiro).resolver();
    await this.sinal(this.enviosConcluidos, this.primeiro).promessa;
    this.sinal(this.liberacoes, this.segundo).resolver();
  }

  /** Destrava qualquer operação ainda retida (limpeza em caso de falha do teste). */
  liberarTudo(): void {
    for (const sinal of this.liberacoes.values()) sinal.resolver();
  }

  private sinal(mapa: Map<string, Sinal>, rotulo: string): Sinal {
    const sinal = mapa.get(rotulo);
    if (!sinal) throw new Error(`Rótulo sem barreira: ${rotulo}`);
    return sinal;
  }
}
