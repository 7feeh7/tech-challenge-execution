import { Injectable } from '@nestjs/common';
import { sanitizeString } from './log-sanitizer';

const TAGS_SENSIVEIS =
  /authorization|jwt|token|justificativa|motivo|sub|responsavel|secret|senha/i;

interface Contador {
  total: number;
  tags: Record<string, string>;
}

@Injectable()
export class MetricsService {
  private readonly contadores = new Map<string, Contador>();
  private readonly gauges = new Map<string, number>();

  increment(nome: string, valor = 1, tags: string[] = []): void {
    const tagMap = tagsParaMapa(tags);
    const chave = `${nome}|${JSON.stringify(tagMap)}`;
    const atual = this.contadores.get(chave) ?? { total: 0, tags: tagMap };
    atual.total += valor;
    this.contadores.set(chave, atual);
  }

  gauge(nome: string, valor: number): void {
    this.gauges.set(nome, valor);
  }

  obterContador(nome: string, tags: string[] = []): number {
    const tagMap = tagsParaMapa(tags);
    const chave = `${nome}|${JSON.stringify(tagMap)}`;
    return this.contadores.get(chave)?.total ?? 0;
  }

  obterGauge(nome: string): number {
    return this.gauges.get(nome) ?? 0;
  }
}

function tagsParaMapa(tags: string[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const tag of tags) {
    const [chave, ...resto] = tag.split(':');
    if (!chave) continue;
    const valor = resto.join(':');
    mapa[chave] = TAGS_SENSIVEIS.test(chave)
      ? '[redacted]'
      : sanitizeString(valor);
  }
  return mapa;
}
