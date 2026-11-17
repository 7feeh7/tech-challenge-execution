import {
  DevolucaoForaDaRodadaInicialError,
  TarefaSituacaoInvalidaError,
} from '../errors/tarefa.errors';
import { SituacaoTarefa } from '../situacao-tarefa.enum';
import { montarTarefaId } from '../tarefa-id';
import type { TipoTarefa } from '../tipo-tarefa.enum';

export interface ItemDiagnostico {
  tipo: 'PECA' | 'SERVICO';
  itemId: string;
  quantidade: number;
}

export interface VeiculoTarefa {
  placa: string;
  modelo: string;
}

export interface ConclusaoDiagnostico {
  laudo: string;
  itens: ItemDiagnostico[];
}

export interface TarefaProps {
  id: string;
  tipo: TipoTarefa;
  ordemServicoId: string;
  rodada: number;
  situacao: SituacaoTarefa;
  correlationId: string;
  veiculo: VeiculoTarefa;
  descricaoProblema: string;
  sugestoes: ItemDiagnostico[];
  responsavelId: string | null;
  conclusaoPendente: ConclusaoDiagnostico | null;
  laudo: string | null;
  propostaItens: ItemDiagnostico[];
  criadoEm: Date;
  iniciadoEm: Date | null;
  devolvidaEm: Date | null;
  concluidaEm: Date | null;
  atualizadoEm: Date;
  versao: number;
}

export type NovaTarefaProps = Pick<
  TarefaProps,
  | 'tipo'
  | 'ordemServicoId'
  | 'rodada'
  | 'correlationId'
  | 'veiculo'
  | 'descricaoProblema'
  | 'sugestoes'
> & { criadoEm: Date };

export class Tarefa {
  private constructor(private props: TarefaProps) {}

  static criar(nova: NovaTarefaProps): Tarefa {
    return new Tarefa({
      ...nova,
      id: montarTarefaId(nova.ordemServicoId, nova.rodada, nova.tipo),
      situacao: SituacaoTarefa.PENDENTE,
      responsavelId: null,
      conclusaoPendente: null,
      laudo: null,
      propostaItens: [],
      iniciadoEm: null,
      devolvidaEm: null,
      concluidaEm: null,
      atualizadoEm: nova.criadoEm,
      versao: 0,
    });
  }

  static restaurar(props: TarefaProps): Tarefa {
    return new Tarefa({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get tipo(): TipoTarefa {
    return this.props.tipo;
  }
  get ordemServicoId(): string {
    return this.props.ordemServicoId;
  }
  get rodada(): number {
    return this.props.rodada;
  }
  get situacao(): SituacaoTarefa {
    return this.props.situacao;
  }
  get correlationId(): string {
    return this.props.correlationId;
  }
  get veiculo(): VeiculoTarefa {
    return this.props.veiculo;
  }
  get descricaoProblema(): string {
    return this.props.descricaoProblema;
  }
  get sugestoes(): ItemDiagnostico[] {
    return this.props.sugestoes;
  }
  get responsavelId(): string | null {
    return this.props.responsavelId;
  }
  get conclusaoPendente(): ConclusaoDiagnostico | null {
    return this.props.conclusaoPendente;
  }
  get laudo(): string | null {
    return this.props.laudo;
  }
  get propostaItens(): ItemDiagnostico[] {
    return this.props.propostaItens;
  }
  get criadoEm(): Date {
    return this.props.criadoEm;
  }
  get iniciadoEm(): Date | null {
    return this.props.iniciadoEm;
  }
  get devolvidaEm(): Date | null {
    return this.props.devolvidaEm;
  }
  get concluidaEm(): Date | null {
    return this.props.concluidaEm;
  }
  get atualizadoEm(): Date {
    return this.props.atualizadoEm;
  }
  get versao(): number {
    return this.props.versao;
  }

  estaEmAndamentoPor(responsavelId: string): boolean {
    return (
      this.props.situacao === SituacaoTarefa.EM_ANDAMENTO &&
      this.props.responsavelId === responsavelId
    );
  }

  iniciar(responsavelId: string, agora: Date): void {
    this.exigirSituacao('iniciar', [SituacaoTarefa.PENDENTE]);
    this.props.situacao = SituacaoTarefa.EM_ANDAMENTO;
    this.props.responsavelId = responsavelId;
    this.props.iniciadoEm = agora;
    this.props.devolvidaEm = null;
    this.atualizar(agora);
  }

  devolverAFila(agora: Date): void {
    this.exigirSituacao('devolver à fila', [SituacaoTarefa.EM_ANDAMENTO]);
    if (this.props.rodada !== 1) {
      throw new DevolucaoForaDaRodadaInicialError(this.props.rodada);
    }
    this.props.situacao = SituacaoTarefa.PENDENTE;
    this.props.responsavelId = null;
    this.props.devolvidaEm = agora;
    this.atualizar(agora);
  }

  registrarConclusaoPendente(
    conclusao: ConclusaoDiagnostico,
    agora: Date,
  ): void {
    this.exigirSituacao('concluir', [SituacaoTarefa.EM_ANDAMENTO]);
    this.props.situacao = SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO;
    this.props.conclusaoPendente = conclusao;
    this.atualizar(agora);
  }

  concluir(agora: Date): void {
    this.exigirSituacao('concluir', [SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO]);
    const conclusao = this.props.conclusaoPendente as ConclusaoDiagnostico;
    this.props.situacao = SituacaoTarefa.CONCLUIDA;
    this.props.laudo = conclusao.laudo;
    this.props.propostaItens = conclusao.itens;
    this.props.conclusaoPendente = null;
    this.props.concluidaEm = agora;
    this.atualizar(agora);
  }

  reabrirAposRecusa(agora: Date): void {
    this.exigirSituacao('reabrir', [SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO]);
    this.props.situacao = SituacaoTarefa.EM_ANDAMENTO;
    this.props.conclusaoPendente = null;
    this.atualizar(agora);
  }

  private exigirSituacao(operacao: string, esperadas: SituacaoTarefa[]): void {
    if (!esperadas.includes(this.props.situacao)) {
      throw new TarefaSituacaoInvalidaError(
        operacao,
        this.props.situacao,
        esperadas,
      );
    }
  }

  private atualizar(agora: Date): void {
    this.props.atualizadoEm = agora;
  }
}
