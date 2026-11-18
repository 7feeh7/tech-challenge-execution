# Prazos operacionais — Execution (E25)

Fonte: `src/shared/messaging/application/calcular-prazos-operacionais-execution.ts`.

## Valores exatos (ConfigMap / Terraform)

| Variável                         |                                                      Valor |
| -------------------------------- | ---------------------------------------------------------: |
| `DYNAMODB_OPERATION_DEADLINE_MS` |                                                      12000 |
| `SQS_OPERATION_DEADLINE_MS`      |                                                      45000 |
| `SQS_LONG_POLL_SECONDS`          |                                                         10 |
| `AWS_SDK_MAX_ATTEMPTS`           |                                                          3 |
| `SQS_CONSUMER_LOTE`              |                                                          3 |
| `OUTBOX_PUBLISHER_LOTE`          |                                                          5 |
| `OUTBOX_GSI_MAX_PAGINAS`         | 8 (teto em runtime; **1 página** no pior caso documentado) |
| `OUTBOX_REIVINDICACAO_MS`        |                                                     480000 |
| `OS_REQUEST_TIMEOUT_MS`          |                                                       3000 |
| `MARGEM_OPERACIONAL_MS`          |                                                      30000 |
| Visibility (Terraform)           |                                                      720 s |
| `terminationGracePeriodSeconds`  |                                                      720 s |

## Pior caso por fluxo (ms)

| Fluxo                                       | Fórmula                       |              Valor |
| ------------------------------------------- | ----------------------------- | -----------------: |
| Transação por mensagem (consumidor)         | 2×3×12000                     |              72000 |
| Mensagem sucesso                            | 72000+45000                   |             117000 |
| Mensagem erro permanente (+DLQ+confirmação) | 117000+2×45000                |             207000 |
| **Ciclo consumidor**                        | 45000+3×207000                | **666000** (666 s) |
| Item outbox                                 | 3×12000+45000                 |              81000 |
| **Ciclo publicador**                        | 1×12000+2×12000+5×81000       | **441000** (441 s) |
| **Diagnóstico HTTP**                        | 3×2×12000+3000                |   **75000** (75 s) |
| **Encerramento**                            | max(666000,441000)+3000+30000 | **699000** (699 s) |

Mínimos validados: visibility ≥ **696** s; grace ≥ **699** s; lease ≥ **471** s.

Margem de **30 s** entra no consumidor (visibility), no publicador (lease mínimo) e no encerramento.

Adotados: visibility **720** s (+54 s sobre 696); grace **720** s (+21 s sobre 699); lease **480000** ms (+9000 ms sobre 471000).

Retries SQS compartilham o mesmo `AbortSignal` por operação — não multiplicam o deadline.

## Impostos no código

| Área           | Implementação                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------- |
| DynamoDB       | `DynamoDbClientProvider.enviar` + `DYNAMODB_OPERATION_DEADLINE_MS`                              |
| SQS            | `FilaSqsGateway` + `sinalOperacaoAws`                                                           |
| Long poll      | `SQS_LONG_POLL_SECONDS` ≤ `SQS_OPERATION_DEADLINE_MS` (`validarConfiguracaoExecution`)          |
| UoW / conflito | `executarComRetentativaConflito` (3) + 2 tentativas no consumidor                               |
| GSI outbox     | `OUTBOX_GSI_MAX_PAGINAS` no repositório                                                         |
| Shutdown       | `AbortController` consumidor; `AgendadorCicloProcessador.parar`; `onModuleDestroy` nos clientes |

Validação fail-closed antes de `NestFactory.create` (`main.ts`).
