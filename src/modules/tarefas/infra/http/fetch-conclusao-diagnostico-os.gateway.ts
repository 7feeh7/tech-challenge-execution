import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ConclusaoDiagnosticoOsGateway,
  ItemOficial,
  PedidoConclusaoDiagnosticoOs,
  ResultadoConclusaoDiagnosticoOs,
} from '../../application/ports/conclusao-diagnostico-os.gateway';

type CorpoOs = Record<string, unknown>;

@Injectable()
export class FetchConclusaoDiagnosticoOsGateway
  implements ConclusaoDiagnosticoOsGateway
{
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl =
      config.get<string>('OS_SERVICE_BASE_URL')?.trim() ||
      'http://localhost:8080';
    this.token = config.get<string>('OS_SERVICE_TOKEN')?.trim() || '';
    this.timeoutMs = Number(
      config.get<string>('OS_REQUEST_TIMEOUT_MS') ?? '3000',
    );
  }

  async concluir(
    pedido: PedidoConclusaoDiagnosticoOs,
  ): Promise<ResultadoConclusaoDiagnosticoOs> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/internal/ordens-servico/${encodeURIComponent(pedido.ordemServicoId)}/diagnostico`;

    try {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Correlation-Id': pedido.correlationId,
          'X-Request-Id': pedido.requestId,
          'Idempotency-Key': `diagnostico:${pedido.tarefaId}`,
        },
        body: JSON.stringify({
          rodada: pedido.rodada,
          tarefaId: pedido.tarefaId,
          laudo: pedido.laudo,
          itens: pedido.itens,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      return await this.interpretar(resposta);
    } catch (erro) {
      return {
        tipo: 'indeterminado',
        motivo:
          erro instanceof Error ? erro.message : 'Erro de rede na conclusão',
      };
    }
  }

  private async interpretar(
    resposta: Response,
  ): Promise<ResultadoConclusaoDiagnosticoOs> {
    const corpo = await this.lerCorpo(resposta);

    if (resposta.status === 200) {
      return this.interpretarSucesso(corpo);
    }

    if (resposta.status >= 400 && resposta.status < 500) {
      return {
        tipo: 'recusada',
        status: resposta.status,
        codigo:
          typeof corpo?.codigo === 'string'
            ? corpo.codigo
            : `HTTP_${resposta.status}`,
        mensagem:
          typeof corpo?.mensagem === 'string'
            ? corpo.mensagem
            : 'Conclusão recusada pelo OS.',
      };
    }

    return {
      tipo: 'indeterminado',
      motivo: `HTTP ${resposta.status} inesperado`,
    };
  }

  private interpretarSucesso(
    corpo: CorpoOs | null,
  ): ResultadoConclusaoDiagnosticoOs {
    // Um 200 ilegível não prova o que o OS gravou: continua indeterminado.
    if (!corpo || !Array.isArray(corpo.itensOficiais)) {
      return {
        tipo: 'indeterminado',
        motivo: 'Resposta 200 sem itensOficiais',
      };
    }
    return {
      tipo: 'sucesso',
      rodada: Number(corpo.rodada),
      itensOficiais: corpo.itensOficiais as ItemOficial[],
    };
  }

  private async lerCorpo(resposta: Response): Promise<CorpoOs | null> {
    try {
      const texto = await resposta.text();
      return texto ? (JSON.parse(texto) as CorpoOs) : null;
    } catch {
      return null;
    }
  }
}
