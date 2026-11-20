import type {
  FilaMensagensGateway,
  MensagemFilaRecebida,
  OpcoesReceberFila,
} from '@/shared/messaging/application/ports/fila-mensagens.gateway';

export class FilaMensagensMemoriaGateway implements FilaMensagensGateway {
  readonly enviados: { fila: string; corpo: string; correlationId: string }[] =
    [];
  private readonly filas = new Map<string, MensagemFilaRecebida[]>();

  async receber(
    filaUrl: string,
    quantidadeMaxima = 10,
    _opcoes?: OpcoesReceberFila,
  ): Promise<MensagemFilaRecebida[]> {
    const fila = this.filas.get(filaUrl) ?? [];
    const lote = fila.splice(0, quantidadeMaxima);
    this.filas.set(filaUrl, fila);
    return lote;
  }

  async confirmar(filaUrl: string, receiptHandle: string): Promise<void> {
    const fila = this.filas.get(filaUrl) ?? [];
    this.filas.set(
      filaUrl,
      fila.filter((m) => m.receiptHandle !== receiptHandle),
    );
  }

  async enviar(
    filaUrl: string,
    envelope: unknown,
    correlationId: string,
  ): Promise<void> {
    const corpo = JSON.stringify(envelope);
    this.enviados.push({ fila: filaUrl, corpo, correlationId });
  }

  async enviarCorpoBruto(
    filaUrl: string,
    corpo: string,
    correlationId: string,
  ): Promise<void> {
    this.enviados.push({ fila: filaUrl, corpo, correlationId });
  }

  enfileirarRecebimento(filaUrl: string, corpo: string): string {
    const receiptHandle = `rh-${Math.random().toString(36).slice(2)}`;
    const fila = this.filas.get(filaUrl) ?? [];
    fila.push({ corpo, receiptHandle });
    this.filas.set(filaUrl, fila);
    return receiptHandle;
  }
}
