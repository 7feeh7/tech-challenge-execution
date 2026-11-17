import { ContextoTransacaoFake } from '@/shared/database/unit-of-work-fake';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { CriarTarefaDiagnosticoUseCase } from './criar-tarefa-diagnostico.use-case';
import { AGORA, criarTarefaGatewayMock } from './test-doubles';

describe('CriarTarefaDiagnosticoUseCase', () => {
  const input = {
    ordemServicoId: 'os-1',
    rodada: 1,
    correlationId: 'corr-1',
    veiculo: { placa: 'ABC1D23', modelo: 'Sedan' },
    descricaoProblema: 'Barulho ao frear',
    sugestoes: [],
  };
  const contexto = new ContextoTransacaoFake();
  let tarefas: ReturnType<typeof criarTarefaGatewayMock>;
  let useCase: CriarTarefaDiagnosticoUseCase;

  beforeEach(() => {
    tarefas = criarTarefaGatewayMock();
    useCase = new CriarTarefaDiagnosticoUseCase(tarefas, () => AGORA);
  });

  it('cria a tarefa pendente com a chave osId#rodada#DIAGNOSTICO', async () => {
    tarefas.existeRegistro.mockResolvedValue(false);

    await expect(useCase.execute(contexto, input)).resolves.toBe(true);

    expect(tarefas.existeRegistro).toHaveBeenCalledWith(
      contexto,
      'os-1#1#DIAGNOSTICO',
    );
    const criada = tarefas.criar.mock.calls[0][1];
    expect(criada.id).toBe('os-1#1#DIAGNOSTICO');
    expect(criada.situacao).toBe(SituacaoTarefa.PENDENTE);
    expect(criada.criadoEm).toEqual(AGORA);
  });

  it('não grava nada quando a chave já existe, inclusive marcador de bloqueio', async () => {
    tarefas.existeRegistro.mockResolvedValue(true);

    await expect(useCase.execute(contexto, input)).resolves.toBe(false);

    expect(tarefas.criar).not.toHaveBeenCalled();
  });
});
