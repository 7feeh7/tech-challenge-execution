# Arquitetura do Execution Service

Repositório autônomo (`tech-challenge-execution`) na Fase 4. Referência de padrões: ADRs 008–015 no repositório `tech-challenge`.

## Responsabilidade

Dono da fila de diagnóstico e reparo e dos eventos `execution.*`. O esqueleto (E03) expõe health, infraestrutura, contratos de mensagens e Terraform (DynamoDB, fila, ECR).

## Estrutura de código

Clean Architecture por módulo em `src/modules/` (`domain/`, `application/`, `infra/` nas etapas de negócio). Código transversal em `src/shared/`.

## Runtime

NestJS 11 sobre Fastify, Node 24, DynamoDB (AWS SDK v3 nas etapas de persistência), namespace Kubernetes `execution`, ServiceAccount `execution-api`, IRSA `tech-challenge-producao-execution-service`.

## Persistência (D5.2)

Tabelas provisionadas no `terraform/` deste repositório:

- `tech-challenge-producao-execution-tarefas`: GSI esparso `gsi-fila-tarefas` (`indiceFila`, `indiceFilaOrdem`), só com tarefas `PENDENTE`.
- `tech-challenge-producao-execution-outbox`: GSI esparso `gsi-publicacao-pendente`; só as pendentes aparecem no índice e o envio remove os atributos dele.
- `tech-challenge-producao-execution-mensagens-processadas`

## Unit of Work

`DynamoDbUnitOfWork` recusa transação aninhada e mais de 100 escritas. O aninhamento é detectado por fluxo assíncrono (`AsyncLocalStorage`, só como marcador), porque o singleton atende requisições HTTP e o consumidor ao mesmo tempo. O `ContextoTransacao` continua explícito. Conflito condicional vira `ConflitoTransacionalError`, e o caso de uso repete com nova leitura (`executarComRetentativaConflito`).

## Autenticação (D6.3)

`modules/auth`: `JwtAuthGuard` e `RolesGuard` globais (`APP_GUARD`). O JWT é validado só com a chave pública RS256 (`JWT_PUBLIC_KEY`, aceita `\n` literal), sem segredo compartilhado. `JWT_ISSUER` e `JWT_AUDIENCE` são opcionais. Rotas públicas usam `@Public()` (health). `TarefaResponsavelGuard` limita o `MECANICO` à tarefa em que é o responsável; `ADMINISTRADOR` passa.

## Tarefas de diagnóstico

`modules/tarefas`: o processador de `execution.iniciar-diagnostico.v1` cria a tarefa `<osId>#<rodada>#DIAGNOSTICO`, e a API (`/v1/tarefas`, `/inicio`, `/devolucao`, `/conclusao`) conduz o ciclo. O `#` do id vai como `%23` na URL.

A conclusão tem três passos:

1. A transação grava `CONCLUSAO_EM_ANDAMENTO` com o payload.
2. O OS é chamado por HTTP, fora da transação, com `Idempotency-Key: diagnostico:<tarefaId>`.
3. Outra transação aplica o resultado: 200 conclui, 4xx volta a `EM_ANDAMENTO` e limpa o payload, e resultado indeterminado mantém o payload para reenvio (HTTP 503).

Variáveis: `OS_SERVICE_BASE_URL`, `OS_SERVICE_TOKEN` (token `execution-os`) e `OS_REQUEST_TIMEOUT_MS`.

## Mensageria

Fila `tech-challenge-producao-execution-in` + DLQ `tech-challenge-producao-execution-in-dlq`.

## Implantação

Pipelines em `.github/workflows/`; deploy efetivo somente na `main` com _environment_ `producao`, conforme runbook da Fase 4.

### Exposição na borda

O Service `execution-api` é `NodePort` com `nodePort: 30082` (`port: 80` e `targetPort: http` mantidos). O listener 8082 do NLB interno encaminha ao target group `tech-challenge-producao-exec-tg` (porta 30082, health check HTTP em `/health`, rota fora do prefixo `v1`). A correspondência vem de `servicos_borda` em `terraform/rotas.tf` do `tech-challenge-infra-kubernetes`; mudar a porta exige alterar os dois repositórios.

### Verificações do deploy e da validação

- O deploy interrompe se a tabela de tarefas não tiver o `gsi-fila-tarefas` ou a outbox não tiver o `gsi-publicacao-pendente` com status `ACTIVE`; tabela inexistente ou erro do `describe-table` também interrompem.
- O `pr-validation` roda `audit-ci` 7.1.0 em dois passos: produção (`--high --skip-dev`) sem exceção e completa com `audit-ci.jsonc`, que permite só o GHSA-fc5q-39xc-vjpf (`picomatch`, desenvolvimento) até 2026-12-18. A imagem final copia só as dependências de produção (estágio `deps` do `Dockerfile`).
