import {
  DevolucaoForaDaRodadaInicialError,
  MotivoFalhaReparoObrigatorioError,
  TarefaInterrupcaoSolicitadaError,
  TarefaSituacaoInvalidaError,
} from '../errors/tarefa.errors';
import { SituacaoTarefa } from '../situacao-tarefa.enum';
import { montarTarefaId } from '../tarefa-id';
import type { TipoDivergenciaPeca } from '../tipo-divergencia-peca.enum';
import type { TipoTarefa } from '../tipo-tarefa.enum';

export interface ItemDiagnostico {
  tipo: 'PECA' | 'SERVICO';
  itemId: string;
  quantidade: number;
}

export interface ItemOficial {
  tipo: 'PECA' | 'SERVICO';
  itemId: string;
  nome: string;
  quantidade: number;
}

export interface ItemUtilizado {
  itemId: string;
  quantidade: number;
}

export interface DivergenciaPeca {
  itemId: string;
  tipo: TipoDivergenciaPeca;
  quantidadePrevista: number;
  quantidadeUtilizada: number;
  observacao: string;
  justificativa?: string;
}

export interface VeiculoTarefa {
  placa: string;
  modelo: string;
}

export interface ConclusaoDiagnostico {
  laudo: string;
  itens: ItemDiagnostico[];
}

export interface ExecucaoReparoGravada {
  servicosRealizados: ItemUtilizado[];
  pecasUtilizadas: ItemUtilizado[];
  divergencias: DivergenciaPeca[];
  responsavelOperacaoId: string;
  motivoFalha: string | null;
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
  itensOficiais: ItemOficial[];
  responsavelId: string | null;
  conclusaoPendente: ConclusaoDiagnostico | null;
  laudo: string | null;
  propostaItens: ItemDiagnostico[];
  servicosRealizados: ItemUtilizado[];
  pecasUtilizadas: ItemUtilizado[];
  divergencias: DivergenciaPeca[];
  responsavelOperacaoId: string | null;
  motivoFalha: string | null;
  falhouEm: Date | null;
  interrompidaEm: Date | null;
  canceladaEm: Date | null;
  motivoCancelamento: string | null;
  fatoTerminalEventId: string | null;
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
  | 'itensOficiais'
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
      servicosRealizados: [],
      pecasUtilizadas: [],
      divergencias: [],
      responsavelOperacaoId: null,
      motivoFalha: null,
      falhouEm: null,
      interrompidaEm: null,
      canceladaEm: null,
      motivoCancelamento: null,
      fatoTerminalEventId: null,
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
  get itensOficiais(): ItemOficial[] {
    return this.props.itensOficiais;
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
  get servicosRealizados(): ItemUtilizado[] {
    return this.props.servicosRealizados;
  }
  get pecasUtilizadas(): ItemUtilizado[] {
    return this.props.pecasUtilizadas;
  }
  get divergencias(): DivergenciaPeca[] {
    return this.props.divergencias;
  }
  get responsavelOperacaoId(): string | null {
    return this.props.responsavelOperacaoId;
  }
  get motivoFalha(): string | null {
    return this.props.motivoFalha;
  }
  get falhouEm(): Date | null {
    return this.props.falhouEm;
  }
  get interrompidaEm(): Date | null {
    return this.props.interrompidaEm;
  }
  get canceladaEm(): Date | null {
    return this.props.canceladaEm;
  }
  get motivoCancelamento(): string | null {
    return this.props.motivoCancelamento;
  }
  get fatoTerminalEventId(): string | null {
    return this.props.fatoTerminalEventId;
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

  estaEncerradaReparo(): boolean {
    return (
      this.props.situacao === SituacaoTarefa.CONCLUIDA ||
      this.props.situacao === SituacaoTarefa.FALHOU ||
      this.props.situacao === SituacaoTarefa.INTERROMPIDA ||
      this.props.situacao === SituacaoTarefa.CANCELADA
    );
  }

  estaTerminal(): boolean {
    return (
      this.props.situacao === SituacaoTarefa.CONCLUIDA ||
      this.props.situacao === SituacaoTarefa.FALHOU ||
      this.props.situacao === SituacaoTarefa.INTERROMPIDA ||
      this.props.situacao === SituacaoTarefa.CANCELADA
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

  cancelarSemInicio(motivo: string | null, agora: Date): void {
    this.exigirSituacao('cancelar', [SituacaoTarefa.PENDENTE]);
    this.props.situacao = SituacaoTarefa.CANCELADA;
    this.props.motivoCancelamento = motivo;
    this.props.canceladaEm = agora;
    this.atualizar(agora);
  }

  cancelarEmAndamento(motivo: string | null, agora: Date): void {
    this.exigirSituacao('cancelar em andamento', [
      SituacaoTarefa.EM_ANDAMENTO,
      SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO,
    ]);
    this.props.situacao = SituacaoTarefa.CANCELADA;
    this.props.motivoCancelamento = motivo;
    this.props.canceladaEm = agora;
    this.props.conclusaoPendente = null;
    this.atualizar(agora);
  }

  solicitarInterrupcao(agora: Date): void {
    this.exigirSituacao('solicitar interrupção', [SituacaoTarefa.EM_ANDAMENTO]);
    this.props.situacao = SituacaoTarefa.INTERRUPCAO_SOLICITADA;
    this.atualizar(agora);
  }

  interromperReparo(execucao: ExecucaoReparoGravada, agora: Date): void {
    this.exigirSituacao('interromper o reparo', [
      SituacaoTarefa.INTERRUPCAO_SOLICITADA,
    ]);
    this.props.situacao = SituacaoTarefa.INTERROMPIDA;
    this.gravarExecucaoReparo(execucao);
    this.props.interrompidaEm = agora;
    this.atualizar(agora);
  }

  atribuirMotivoCancelamento(motivo: string | null): void {
    if (this.props.motivoCancelamento === null && motivo) {
      this.props.motivoCancelamento = motivo;
    }
  }

  registrarFatoTerminalEventId(eventId: string): void {
    if (!this.props.fatoTerminalEventId) {
      this.props.fatoTerminalEventId = eventId;
    }
  }

  concluirReparo(execucao: ExecucaoReparoGravada, agora: Date): void {
    this.recusarSeInterrupcao('concluir o reparo');
    this.exigirSituacao('concluir o reparo', [SituacaoTarefa.EM_ANDAMENTO]);
    this.props.situacao = SituacaoTarefa.CONCLUIDA;
    this.gravarExecucaoReparo(execucao);
    this.props.concluidaEm = agora;
    this.atualizar(agora);
  }

  falharReparo(execucao: ExecucaoReparoGravada, agora: Date): void {
    this.recusarSeInterrupcao('registrar falha do reparo');
    this.exigirSituacao('registrar falha do reparo', [
      SituacaoTarefa.EM_ANDAMENTO,
    ]);
    const motivo = execucao.motivoFalha?.trim();
    if (!motivo) {
      throw new MotivoFalhaReparoObrigatorioError();
    }
    this.props.situacao = SituacaoTarefa.FALHOU;
    this.gravarExecucaoReparo({ ...execucao, motivoFalha: motivo });
    this.props.falhouEm = agora;
    this.atualizar(agora);
  }

  private gravarExecucaoReparo(execucao: ExecucaoReparoGravada): void {
    this.props.servicosRealizados = execucao.servicosRealizados;
    this.props.pecasUtilizadas = execucao.pecasUtilizadas;
    this.props.divergencias = execucao.divergencias;
    this.props.responsavelOperacaoId = execucao.responsavelOperacaoId;
    this.props.motivoFalha = execucao.motivoFalha;
  }

  private recusarSeInterrupcao(operacao: string): void {
    if (this.props.situacao === SituacaoTarefa.INTERRUPCAO_SOLICITADA) {
      throw new TarefaInterrupcaoSolicitadaError(operacao);
    }
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
