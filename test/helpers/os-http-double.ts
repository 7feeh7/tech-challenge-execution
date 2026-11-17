import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RespostaOsDouble {
  status: number;
  corpo?: unknown;
  atrasoMs?: number;
}

export interface RequisicaoOsRecebida {
  metodo: string;
  caminho: string;
  headers: IncomingHttpHeaders;
  corpo: Record<string, unknown>;
}

/** Dublê HTTP do OS (`POST /internal/ordens-servico/{id}/diagnostico`). */
export class OsHttpDouble {
  readonly requisicoes: RequisicaoOsRecebida[] = [];
  private readonly respostas: RespostaOsDouble[] = [];
  private servidor?: Server;

  respostaPadrao: RespostaOsDouble = {
    status: 200,
    corpo: { rodada: 1, itensOficiais: [] },
  };

  enfileirarResposta(resposta: RespostaOsDouble): void {
    this.respostas.push(resposta);
  }

  reiniciar(): void {
    this.requisicoes.length = 0;
    this.respostas.length = 0;
  }

  async iniciar(): Promise<string> {
    const servidor = createServer((req, res) => {
      void this.atender(req, res);
    });
    this.servidor = servidor;
    await new Promise<void>((resolve) =>
      servidor.listen(0, '127.0.0.1', resolve),
    );
    const { port } = servidor.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async parar(): Promise<void> {
    this.servidor?.closeAllConnections();
    await new Promise<void>((resolve) => this.servidor?.close(() => resolve()));
  }

  private async atender(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const partes: Buffer[] = [];
    for await (const parte of req) partes.push(parte as Buffer);
    const texto = Buffer.concat(partes).toString('utf-8');
    this.requisicoes.push({
      metodo: req.method ?? '',
      caminho: req.url ?? '',
      headers: req.headers,
      corpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : {},
    });

    const resposta = this.respostas.shift() ?? this.respostaPadrao;
    if (resposta.atrasoMs) {
      await new Promise((resolve) => setTimeout(resolve, resposta.atrasoMs));
    }
    if (res.destroyed) return;
    res.writeHead(resposta.status, { 'Content-Type': 'application/json' });
    res.end(resposta.corpo === undefined ? '' : JSON.stringify(resposta.corpo));
  }
}
