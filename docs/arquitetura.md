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

- `tech-challenge-producao-execution-tarefas`
- `tech-challenge-producao-execution-outbox`
- `tech-challenge-producao-execution-mensagens-processadas`

## Mensageria

Fila `tech-challenge-producao-execution-in` + DLQ `tech-challenge-producao-execution-in-dlq`.

## Implantação

Pipelines em `.github/workflows/`; deploy efetivo somente na `main` com _environment_ `producao`, conforme runbook da Fase 4.
