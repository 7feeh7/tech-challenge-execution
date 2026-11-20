export interface ResponsavelTarefa {
  existe: boolean;
  responsavelId: string | null;
}

export interface ResponsavelTarefaGateway {
  buscarResponsavel(tarefaId: string): Promise<ResponsavelTarefa>;
}
