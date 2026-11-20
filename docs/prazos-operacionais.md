# Prazos operacionais — Execution (E25)

Fonte: `src/shared/messaging/application/calcular-prazos-operacionais-execution.ts`. A validação fail-closed da partida (`validarConfiguracaoExecution`) chama a mesma função.

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
| `terminationGracePeriodSeconds`  |                                870 s |

Deadline não explícito: sem `DYNAMODB_OPERATION_DEADLINE_MS` ou `SQS_OPERATION_DEADLINE_MS`, o deadline é o timeout da tentativa HTTP × `AWS_SDK_MAX_ATTEMPTS` (DynamoDB: `DYNAMODB_HTTP_ATTEMPT_TIMEOUT_MS`, padrão 4000; SQS: `SQS_HTTP_ATTEMPT_TIMEOUT_MS`, depois `SQS_REQUEST_TIMEOUT_MS`, padrão 12000; tentativas, padrão 3). Clientes e validação fail-closed usam a mesma função (`resolverDeadlineOperacaoAws`), então os mínimos acompanham o deadline que o runtime realmente aplica.

O deadline de cada operação AWS (`DynamoDbClientProvider.enviar`, `FilaSqsGateway`) é imposto por `AbortSignal` e cobre as tentativas internas do SDK (`AWS_SDK_MAX_ATTEMPTS`): uma operação nunca passa do deadline, com ou sem retry.

## Operações contadas por caminho

| Caminho                               | Operações                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execução da transação do consumidor   | 4 DynamoDB: `jaProcessada`, `existeRegistro`, `buscarPorId` (cancelamento sem tarefa; leitura nula não entra no cache do contexto) e `TransactWriteItems`  |
| Mensagem do consumidor                | até 2 execuções (`ProcessarMensagemEntradaService` repete uma vez após conflito; o consumidor não usa `executarComRetentativaConflito`)                    |
| Sucesso / erro permanente             | sucesso: transação + 1 SQS (confirmação); erro permanente: transação + 2 SQS (DLQ e confirmação). Erro da AWS na confirmação é transitório e não vai à DLQ |
| Item da outbox                        | 1 SQS (envio) + `confirmarEnvio`; se a confirmação falhar, `liberarAposFalha`: 1 SQS + 2 DynamoDB                                                          |
| Reivindicação da outbox               | 1 `UpdateItem` por candidata, até o lote                                                                                                                   |
| Listagem e contagem da outbox         | 1 `Query` por página, até `OUTBOX_GSI_MAX_PAGINAS`                                                                                                         |
| Requisição HTTP com guard (não admin) | 1 `GetItem` do `TarefaResponsavelGuard`; cada unidade de trabalho com até 3 tentativas de 2 operações (leitura e `TransactWriteItems`)                     |
| Conclusão do diagnóstico              | guard + gravar payload pendente (3×2) + chamada ao OS (`OS_REQUEST_TIMEOUT_MS`, sem retry) + aplicar resultado (3×2)                                       |

As demais rotas ficam abaixo da conclusão do diagnóstico: devolução, conclusão e falha do reparo e interrupção fazem guard + uma unidade de trabalho (7 operações, 84000 ms); início faz uma unidade (72000 ms).

## Pior caso por fluxo (ms)

| Termo                                       | Fórmula                      |      Valor |
| ------------------------------------------- | ---------------------------- | ---------: |
| Execução da transação (consumidor)          | 4×12000                      |      48000 |
| Transação por mensagem (consumidor)         | 2×48000                      |      96000 |
| Mensagem com sucesso                        | 96000+45000                  |     141000 |
| Mensagem com erro permanente (DLQ+confirma) | 96000+2×45000                |     186000 |
| **Ciclo consumidor**                        | 45000 (recebimento)+3×186000 | **603000** |
| Listagem GSI (publicador)                   | 8×12000                      |      96000 |
| Reivindicação (publicador, dentro do lease) | 5×12000                      |      60000 |
| Item da outbox                              | 45000+2×12000                |      69000 |
| **Lease outbox** (da reivindicação ao fim)  | 5×12000+5×69000              | **405000** |
| Contagem do backlog (publicador)            | 8×12000                      |      96000 |
| **Ciclo publicador**                        | 96000+405000+96000           | **597000** |
| Guard do responsável                        | 1×12000                      |      12000 |
| Unidade de trabalho HTTP                    | 3×2×12000                    |      72000 |
| **Diagnóstico HTTP (conclusão, não admin)** | 12000+72000+3000+72000       | **159000** |
| Drenagem da mensageria                      | max(603000, 597000)          |     603000 |
| Keep-alive do Fastify (`keepAliveTimeout`)  | default do Fastify 5         |      72000 |
| **Encerramento**                            | 603000+159000+72000+30000    | **864000** |

## Mínimos validados

| Configuração                                                         | Fórmula do mínimo   |    Mínimo |   Adotado |
| -------------------------------------------------------------------- | ------------------- | --------: | --------: |
| Visibility (`SQS_VISIBILITY_TIMEOUT_SECONDS`)                        | (603000+30000)/1000 |     633 s |     720 s |
| Lease (`OUTBOX_REIVINDICACAO_MS`)                                    | 405000+30000        | 435000 ms | 480000 ms |
| `terminationGracePeriodSeconds` / `TERMINATION_GRACE_PERIOD_SECONDS` | 864000/1000         |     864 s |     870 s |

Margem de **30 s** na visibilidade, no lease e no encerramento.

Keep-alive HTTP: a conexão que estava ocupada com uma requisição no `close()` só é fechada quando atinge o `keepAliveTimeout` do Fastify (72 s, default do Fastify 5, não alterado em `main.ts`). O fechamento do HTTP pode então durar até 72 s depois da última resposta, e o termo entra no encerramento. Medido com um cliente keep-alive: o `close()` levou ~70 s depois da resposta.

Premissas conservadoras: o ciclo do consumidor inclui o recebimento (45000 ms), que o encerramento cancela (`sinalAbortamento`) e que não conta para a visibilidade (o relógio começa no retorno do `ReceiveMessage`); as duas execuções de 4 operações por mensagem são um limite superior (o erro permanente raramente usa as duas). A listagem e a contagem não entram na visibilidade.

## Lease da outbox

O `bloqueadoAte` é calculado em `PublicadorOutboxService.reivindicarLote` depois da listagem e antes do laço de reivindicação. Todas as reivindicações do lote compartilham esse instante, então o lease cobre reivindicar até `OUTBOX_PUBLISHER_LOTE` itens, enviar cada um e confirmar ou liberar o último. A listagem (antes) e a contagem (depois) ficam fora do lease, mas dentro do ciclo.

## Semântica do backlog

`contarPendentes` consulta no máximo `OUTBOX_GSI_MAX_PAGINAS` páginas do GSI. Quando `truncada: true`, a métrica `oficina.outbox.pendentes` carrega tag `truncada:true` — valor é **mínimo conhecido**, não total exato.

## Impostos no código

| Área           | Implementação                                                                           |
| -------------- | --------------------------------------------------------------------------------------- |
| DynamoDB       | `DynamoDbClientProvider.enviar` + `DYNAMODB_OPERATION_DEADLINE_MS`                      |
| SQS            | `FilaSqsGateway` + `sinalOperacaoAws`                                                   |
| Long poll      | `SQS_LONG_POLL_SECONDS` ≤ `SQS_OPERATION_DEADLINE_MS` (`validarConfiguracaoExecution`)  |
| UoW / conflito | HTTP: `executarComRetentativaConflito` (3); consumidor: 2 execuções da transação        |
| GSI outbox     | `OUTBOX_GSI_MAX_PAGINAS` na listagem e na contagem                                      |
| Shutdown       | `beforeApplicationShutdown` nos processadores; `onApplicationShutdown` nos clientes AWS |

Validação fail-closed antes de `NestFactory.create` (`main.ts`).
