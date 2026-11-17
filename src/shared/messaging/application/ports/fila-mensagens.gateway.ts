export interface MensagemFilaRecebida {
  corpo: string;
  receiptHandle: string;
}

export interface OpcoesReceberFila {
  sinalAbortamento?: AbortSignal;
}

export interface FilaMensagensGateway {
  receber(
    filaUrl: string,
    quantidadeMaxima?: number,
    opcoes?: OpcoesReceberFila,
  ): Promise<MensagemFilaRecebida[]>;
  confirmar(filaUrl: string, receiptHandle: string): Promise<void>;
  enviar(
    filaUrl: string,
    envelope: unknown,
    correlationId: string,
  ): Promise<void>;
  enviarCorpoBruto(
    filaUrl: string,
    corpo: string,
    correlationId: string,
  ): Promise<void>;
}
