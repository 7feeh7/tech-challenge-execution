export class ConfiguracaoExecutionInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ConfiguracaoExecutionInvalidaError';
  }
}
