import { forwardRef, Module } from '@nestjs/common';
import { ProcessadorCancelarTarefa } from '@/modules/tarefas/infra/messaging/processador-cancelar-tarefa';
import { ProcessadorIniciarDiagnostico } from '@/modules/tarefas/infra/messaging/processador-iniciar-diagnostico';
import { ProcessadorIniciarReparo } from '@/modules/tarefas/infra/messaging/processador-iniciar-reparo';
import { TarefasModule } from '@/modules/tarefas/tarefas.module';
import { DynamoDbModule } from '@/shared/database/dynamodb.module';
import { MessagingMetricsService } from '@/shared/observability/messaging-metrics.service';
import { ObservabilityModule } from '@/shared/observability/observability.module';
import {
  FILA_MENSAGENS,
  MARCADOR_EFEITO_GATEWAY,
  MENSAGEM_PROCESSADA_GATEWAY,
  OUTBOX_GATEWAY,
  PROCESSADORES_MENSAGEM,
} from './application/ports/tokens';
import { ProcessarMensagemEntradaService } from './application/services/processar-mensagem-entrada.service';
import { RoteadorProcessadoresMensagemService } from './application/services/roteador-processadores-mensagem.service';
import { ConsumidorFilaExecutionService } from './infra/consumo/consumidor-fila-execution.service';
import { PublicadorOutboxService } from './infra/outbox/publicador-outbox.service';
import { DynamoDbMarcadorEfeitoGateway } from './infra/persistence/dynamodb-marcador-efeito.gateway';
import { DynamoDbMensagemProcessadaGateway } from './infra/persistence/dynamodb-mensagem-processada.gateway';
import { DynamoDbOutboxGateway } from './infra/persistence/dynamodb-outbox.gateway';
import { DynamoDbOutboxRepositorio } from './infra/persistence/dynamodb-outbox-repositorio';
import { FilaSqsGateway } from './infra/sqs/fila-sqs.gateway';

@Module({
  imports: [
    DynamoDbModule,
    ObservabilityModule,
    forwardRef(() => TarefasModule),
  ],
  providers: [
    FilaSqsGateway,
    { provide: FILA_MENSAGENS, useExisting: FilaSqsGateway },
    DynamoDbMensagemProcessadaGateway,
    {
      provide: MENSAGEM_PROCESSADA_GATEWAY,
      useExisting: DynamoDbMensagemProcessadaGateway,
    },
    DynamoDbOutboxGateway,
    { provide: OUTBOX_GATEWAY, useExisting: DynamoDbOutboxGateway },
    DynamoDbMarcadorEfeitoGateway,
    {
      provide: MARCADOR_EFEITO_GATEWAY,
      useExisting: DynamoDbMarcadorEfeitoGateway,
    },
    DynamoDbOutboxRepositorio,
    MessagingMetricsService,
    {
      provide: PROCESSADORES_MENSAGEM,
      useFactory: (
        iniciarDiagnostico: ProcessadorIniciarDiagnostico,
        iniciarReparo: ProcessadorIniciarReparo,
        cancelarTarefa: ProcessadorCancelarTarefa,
      ) => [iniciarDiagnostico, iniciarReparo, cancelarTarefa],
      inject: [
        ProcessadorIniciarDiagnostico,
        ProcessadorIniciarReparo,
        ProcessadorCancelarTarefa,
      ],
    },
    RoteadorProcessadoresMensagemService,
    ProcessarMensagemEntradaService,
    PublicadorOutboxService,
    ConsumidorFilaExecutionService,
  ],
  exports: [
    FILA_MENSAGENS,
    MENSAGEM_PROCESSADA_GATEWAY,
    OUTBOX_GATEWAY,
    MARCADOR_EFEITO_GATEWAY,
    DynamoDbOutboxRepositorio,
    PublicadorOutboxService,
    ProcessarMensagemEntradaService,
    ConsumidorFilaExecutionService,
    MessagingMetricsService,
  ],
})
export class MensageriaModule {}
