import {
  DomainConflictError,
  DomainNotFoundError,
  DomainUnavailableError,
  DomainUnprocessableError,
  DomainValidationError,
} from '@/shared/exceptions/domain.error';
import type { SituacaoTarefa } from '../situacao-tarefa.enum';

export class TarefaNaoEncontradaError extends DomainNotFoundError {
  constructor(id: string) {
    super(`Tarefa "${id}" não encontrada.`);
  }
}

export class TarefaSituacaoInvalidaError extends DomainConflictError {
  constructor(
    operacao: string,
    situacaoAtual: SituacaoTarefa,
    esperadas: SituacaoTarefa[],
  ) {
    super(
      `Não é possível ${operacao} uma tarefa em ${situacaoAtual}; situação esperada: ${esperadas.join(' ou ')}.`,
    );
  }
}

export class DevolucaoForaDaRodadaInicialError extends DomainConflictError {
  constructor(rodada: number) {
    super(
      `Só é possível devolver à fila o diagnóstico da rodada 1; a tarefa está na rodada ${rodada}.`,
    );
  }
}

export class ConclusaoRecusadaPeloOsConflitoError extends DomainConflictError {
  constructor(codigo: string, mensagem: string) {
    super(`Conclusão recusada pelo OS (${codigo}): ${mensagem}`);
  }
}

export class ConclusaoRecusadaPeloOsError extends DomainUnprocessableError {
  constructor(codigo: string, mensagem: string) {
    super(`Conclusão recusada pelo OS (${codigo}): ${mensagem}`);
  }
}

export class ConclusaoIndeterminadaError extends DomainUnavailableError {
  constructor(motivo: string) {
    super(
      `O OS não respondeu de forma definitiva (${motivo}). A conclusão segue pendente; repita a chamada para reenviar o mesmo conteúdo.`,
    );
  }
}

export class CursorTarefasInvalidoError extends DomainValidationError {
  constructor() {
    super('Cursor de paginação inválido.');
  }
}
