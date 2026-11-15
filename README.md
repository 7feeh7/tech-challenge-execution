# tech-challenge-execution

Microsserviço **Execution** — fila de diagnóstico e reparo da oficina (Fase 4).

## Stack

- Node.js 24, TypeScript, NestJS 11 (Fastify)
- DynamoDB (persistência a partir da E21)
- Biome (lint/format), Jest (testes)
- Terraform: fila `execution-in`, ECR, três tabelas DynamoDB

## Desenvolvimento local

```bash
yarn install --frozen-lockfile
yarn lint
yarn build
yarn test
yarn test:cov
```

Integração com DynamoDB Local (porta 8000):

```bash
export DYNAMODB_ENDPOINT=http://localhost:8000
yarn test:int
```

## Health

- `GET /health` — liveness
- `GET /health/ready` — readiness

## Documentação

- [`docs/arquitetura.md`](docs/arquitetura.md)
- [`docs/contratos/mensagens-execution.md`](docs/contratos/mensagens-execution.md)

## CI

Workflow `PR Validation` na `develop` e em PRs para `main`/`develop`. Deploy só na `main` (`environment: producao`).
