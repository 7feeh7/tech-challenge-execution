# Prazos operacionais — Execution (E25)

Fonte de cálculo: `src/shared/messaging/application/calcular-prazos-operacionais-execution.ts`.

## Padrões de produção (ConfigMap)

| Variável | Valor |
| --- | ---: |
| `DYNAMODB_OPERATION_DEADLINE_MS` | 12000 |
| `SQS_OPERATION_DEADLINE_MS` | 45000 |
| `SQS_LONG_POLL_SECONDS` | 10 |
| `AWS_SDK_MAX_ATTEMPTS` | 3 |
| `SQS_CONSUMER_LOTE` | 3 |
| `OUTBOX_PUBLISHER_LOTE` | 5 |
| `OUTBOX_GSI_MAX_PAGINAS` | 8 |
| `OUTBOX_REIVINDICACAO_MS` | 480000 |
| `OS_REQUEST_TIMEOUT_MS` | 3000 |
| `sqs_visibility_timeout_seconds` (Terraform) | 720 |
| `terminationGracePeriodSeconds` (Deployment) | 720 |

## Pior caso por fluxo (margem 30 s)

| Fluxo | Cálculo resumido | Duração |
| --- | --- | ---: |
| Consumidor (lote 3, erro permanente + DLQ + confirmação) | 45 s receive + 3×(72 s transações + 45 s confirmação + 90 s DLQ) | **666 s** |
| Publicador outbox (lote 5) | 1×Query GSI + claims + 5×(3×DDB + SQS + confirm) | **~441 s** |
| Conclusão diagnóstico (HTTP síncrono) | 3×conflito×2×DDB + timeout OS | **75 s** |
| Encerramento gracioso | max(consumidor, publicador) + HTTP OS em voo + margem | **~699 s** |

O receive SQS usa `AbortSignal` único por operação: `maxAttempts` do SDK não multiplica o deadline total.

## Impostos no código

| Área | Mecanismo |
| --- | --- |
| DynamoDB | `DynamoDbClientProvider.enviar()` + `DYNAMODB_OPERATION_DEADLINE_MS` |
| SQS | `FilaSqsGateway` + `sinalOperacaoAws(SQS_OPERATION_DEADLINE_MS)` |
| Long polling | `WaitTimeSeconds` ≤ deadline SQS (validado em `validarConfiguracaoExecution`) |
| Conflito transacional | `executarComRetentativaConflito` (3 tentativas) + 2 tentativas no consumidor de mensagens |
| Outbox GSI | `OUTBOX_GSI_MAX_PAGINAS` limita páginas por ciclo |
| Shutdown | `AbortController` no consumidor; `AgendadorCicloProcessador.parar()` aguarda ciclo; `client.destroy()` nos gateways |

Validação na partida: `validarConfiguracaoExecution()` (antes de `NestFactory.create`) recusa prazos incoerentes; produção exige RS256, filas e segredos sem `DYNAMODB_ENDPOINT`.