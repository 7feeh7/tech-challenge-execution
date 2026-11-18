# Prazos operacionais — Execution (E25)

Fonte: `src/shared/messaging/application/calcular-prazos-operacionais-execution.ts`.

## Valores exatos (ConfigMap / Terraform)

| Variável                         |                                Valor |
| -------------------------------- | -----------------------------------: |
| `DYNAMODB_OPERATION_DEADLINE_MS` |                                12000 |
| `SQS_OPERATION_DEADLINE_MS`      |                                45000 |
| `SQS_LONG_POLL_SECONDS`          |                                   10 |
| `AWS_SDK_MAX_ATTEMPTS`           |                                    3 |
| `SQS_CONSUMER_LOTE`              |                                    3 |
| `OUTBOX_PUBLISHER_LOTE`          |                                    5 |
| `OUTBOX_GSI_MAX_PAGINAS`         | 8 (listagem, contagem e fail-closed) |
| `OUTBOX_REIVINDICACAO_MS`        |                               480000 |
| `OS_REQUEST_TIMEOUT_MS`          |                                 3000 |
| `MARGEM_OPERACIONAL_MS`          |                                30000 |
| Visibility (Terraform)           |                                720 s |
| `terminationGracePeriodSeconds`  |                                850 s |

## Semântica do backlog

`contarPendentes` consulta no máximo `OUTBOX_GSI_MAX_PAGINAS` páginas do GSI. Quando `truncada: true`, a métrica `oficina.outbox.pendentes` carrega tag `truncada:true` — valor é **mínimo conhecido**, não total exato.

## Pior caso por fluxo (ms)

| Fluxo                                       | Fórmula                         |      Valor |
| ------------------------------------------- | ------------------------------- | ---------: |
| Transação por mensagem (consumidor)         | 2×3×12000                       |      72000 |
| Mensagem sucesso                            | 72000+45000                     |     117000 |
| Mensagem erro permanente (+DLQ+confirmação) | 117000+2×45000                  |     207000 |
| **Ciclo consumidor**                        | 45000+3×207000                  | **666000** |
| Listagem GSI (publicador)                   | 8×12000                         |      96000 |
| Contagem backlog (publicador)               | 8×12000                         |      96000 |
| Reivindicação (publicador)                  | 5×12000                         |      60000 |
| Item outbox (com lease ativo)               | 3×12000+45000                   |      81000 |
| **Ciclo publicador**                        | 96000+60000+5×81000+96000       | **657000** |
| **Lease outbox** (após reivindicação)       | 5×81000                         | **405000** |
| **Diagnóstico HTTP**                        | 2×(3×2×12000)+3000              | **147000** |
| **Encerramento**                            | max(666000,657000)+147000+30000 | **843000** |

Mínimos validados: visibility ≥ **696** s; grace ≥ **843** s; lease ≥ **435** s.

Margem de **30 s** no consumidor (visibility), no lease mínimo e no encerramento.

Adotados: visibility **720** s; grace **850** s; lease **480000** ms.

O lease (`OUTBOX_REIVINDICACAO_MS`) começa na reivindicação bem-sucedida; listagem e contagem integram o ciclo, não o lease.

## Impostos no código

| Área           | Implementação                                                                           |
| -------------- | --------------------------------------------------------------------------------------- |
| DynamoDB       | `DynamoDbClientProvider.enviar` + `DYNAMODB_OPERATION_DEADLINE_MS`                      |
| SQS            | `FilaSqsGateway` + `sinalOperacaoAws`                                                   |
| Long poll      | `SQS_LONG_POLL_SECONDS` ≤ `SQS_OPERATION_DEADLINE_MS` (`validarConfiguracaoExecution`)  |
| UoW / conflito | `executarComRetentativaConflito` (3) + 2 tentativas no consumidor                       |
| GSI outbox     | `OUTBOX_GSI_MAX_PAGINAS` na listagem e na contagem                                      |
| Shutdown       | `beforeApplicationShutdown` nos processadores; `onApplicationShutdown` nos clientes AWS |

Validação fail-closed antes de `NestFactory.create` (`main.ts`).
