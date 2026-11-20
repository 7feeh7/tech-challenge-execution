/** Variáveis de ambiente costumam trazer a chave PEM com `\n` literal. */
export function normalizarChavePublica(chave: string): string {
  return chave.replace(/\n/g, '\n');
}
