export const TIPO_REGISTRO_MARCADOR_BLOQUEIO = 'MARCADOR_BLOQUEIO';

export function ehMarcadorBloqueio(registro: Record<string, unknown>): boolean {
  return registro.tipo === TIPO_REGISTRO_MARCADOR_BLOQUEIO;
}
