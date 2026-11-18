# Prazos operacionais — Execution (E25)

Fonte de cálculo: `src/shared/messaging/application/calcular-prazos-operacionais-execution.ts`.

## Padrões de produção (ConfigMap)

| Variável | Valor |
| --- | ---: |
| `DYNAMODB_OPERATION_DEADLINE_MS` | 12000 |
| `SQS_OPERATION_DEADLINE_MS` | 45000 |
| `SQS_LONG_POLL_SECONDS` | 10 |
| `SQS_CONSUMER_LOTE` | 3 |
| `OUTBOX_PUBLISHER_LOTE` | 5 |
| `OUTBOX_REIVINDICACAO_MS` | 480000 |
| `OS_REQUEST_TIMEOUT_MS` | 3000 |
| `sqs_visibility_timeout_seconds` (Terraform) | 720 |
| `terminationGracePeriodSeconds` (Deployment) | 720 |

## Pior caso (com margem 30 s)

| Fluxo | Duração acumulada |
| --- | ---: |
| Ciclo consumidor (erro permanente, lote 3) | 666 s |
| Ciclo publicador (lote 5) | 339 s |
| Requisição HTTP conclusão diagnóstico | 75 s |
| Encerramento gracioso | 696 s |

Validação na partida: `validarConfiguracaoExecution()` recusa prazos incoerentes em qualquer ambiente; em produção exige segredos, filas e RS256.