import { forwardRef, Module } from '@nestjs/common';
import { TarefaResponsavelGuard } from '@/modules/auth/guards/tarefa-responsavel.guard';
import { RESPONSAVEL_TAREFA_GATEWAY } from '@/modules/auth/ports/tokens';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import { UNIT_OF_WORK } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { OUTBOX_GATEWAY } from '@/shared/messaging/application/ports/tokens';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import type { ConclusaoDiagnosticoOsGateway } from './application/ports/conclusao-diagnostico-os.gateway';
import type { TarefaGateway } from './application/ports/tarefa.gateway';
import {
  CONCLUSAO_DIAGNOSTICO_OS_GATEWAY,
  TAREFA_GATEWAY,
} from './application/ports/tokens';
import { BuscarTarefaUseCase } from './application/use-cases/buscar-tarefa.use-case';
import { ConcluirTarefaDiagnosticoUseCase } from './application/use-cases/concluir-tarefa-diagnostico.use-case';
import { CriarTarefaDiagnosticoUseCase } from './application/use-cases/criar-tarefa-diagnostico.use-case';
import { DevolverTarefaDiagnosticoUseCase } from './application/use-cases/devolver-tarefa-diagnostico.use-case';
import { IniciarTarefaDiagnosticoUseCase } from './application/use-cases/iniciar-tarefa-diagnostico.use-case';
import { ListarTarefasUseCase } from './application/use-cases/listar-tarefas.use-case';
import { TarefasController } from './infra/http/controllers/tarefas.controller';
import { FetchConclusaoDiagnosticoOsGateway } from './infra/http/fetch-conclusao-diagnostico-os.gateway';
import { ProcessadorIniciarDiagnostico } from './infra/messaging/processador-iniciar-diagnostico';
import { DynamoDbTarefaGateway } from './infra/persistence/dynamodb-tarefa.gateway';

@Module({
  // Ciclo intencional: a mensageria roteia comandos para os processadores
  // da tarefa, e a tarefa grava eventos na outbox da mensageria.
  imports: [forwardRef(() => MensageriaModule)],
  controllers: [TarefasController],
  providers: [
    DynamoDbTarefaGateway,
    { provide: TAREFA_GATEWAY, useExisting: DynamoDbTarefaGateway },
    {
      provide: RESPONSAVEL_TAREFA_GATEWAY,
      useExisting: DynamoDbTarefaGateway,
    },
    FetchConclusaoDiagnosticoOsGateway,
    {
      provide: CONCLUSAO_DIAGNOSTICO_OS_GATEWAY,
      useExisting: FetchConclusaoDiagnosticoOsGateway,
    },
    TarefaResponsavelGuard,
    {
      provide: CriarTarefaDiagnosticoUseCase,
      useFactory: (tarefas: TarefaGateway) =>
        new CriarTarefaDiagnosticoUseCase(tarefas),
      inject: [TAREFA_GATEWAY],
    },
    {
      provide: IniciarTarefaDiagnosticoUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        tarefas: TarefaGateway,
        outbox: OutboxGateway,
      ) => new IniciarTarefaDiagnosticoUseCase(unitOfWork, tarefas, outbox),
      inject: [UNIT_OF_WORK, TAREFA_GATEWAY, OUTBOX_GATEWAY],
    },
    {
      provide: DevolverTarefaDiagnosticoUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        tarefas: TarefaGateway,
        outbox: OutboxGateway,
      ) => new DevolverTarefaDiagnosticoUseCase(unitOfWork, tarefas, outbox),
      inject: [UNIT_OF_WORK, TAREFA_GATEWAY, OUTBOX_GATEWAY],
    },
    {
      provide: ConcluirTarefaDiagnosticoUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        tarefas: TarefaGateway,
        os: ConclusaoDiagnosticoOsGateway,
      ) => new ConcluirTarefaDiagnosticoUseCase(unitOfWork, tarefas, os),
      inject: [UNIT_OF_WORK, TAREFA_GATEWAY, CONCLUSAO_DIAGNOSTICO_OS_GATEWAY],
    },
    {
      provide: ListarTarefasUseCase,
      useFactory: (tarefas: TarefaGateway) => new ListarTarefasUseCase(tarefas),
      inject: [TAREFA_GATEWAY],
    },
    {
      provide: BuscarTarefaUseCase,
      useFactory: (tarefas: TarefaGateway) => new BuscarTarefaUseCase(tarefas),
      inject: [TAREFA_GATEWAY],
    },
    ProcessadorIniciarDiagnostico,
  ],
  exports: [ProcessadorIniciarDiagnostico],
})
export class TarefasModule {}
