# tech-challenge-execution

Microsserviço **Execution** — fila de diagnóstico e reparo (Fase 4).

## Stack

- Node.js 24, TypeScript, NestJS 11 (Fastify)
- DynamoDB (persistência transacional + outbox)
- SQS (`execution-in`, publicação para `os-in`)
- Biome, Jest

## Desenvolvimento local

```bash
yarn install --frozen-lockfile
yarn lint
yarn build
yarn test
yarn test:cov
export DYNAMODB_ENDPOINT=http://localhost:8000
yarn test:int
yarn test:e2e
```

Swagger: `GET /docs` após `yarn start:dev`.

## Configuração operacional

- Variáveis: `.env.example`
- Prazos e pior caso: [`docs/prazos-operacionais.md`](docs/prazos-operacionais.md)
- Arquitetura: [`docs/arquitetura.md`](docs/arquitetura.md)
- Contratos: [`docs/contratos/`](docs/contratos/)

**Produção:** `validarConfiguracaoExecution()` na partida exige JWT RS256, tokens OS, filas, tabelas DynamoDB e prazos coerentes. Processadores **desligados** no ConfigMap até o runbook (`SQS_CONSUMER_HABILITADO` / `OUTBOX_PUBLISHER_HABILITADO` = `false`).

## Health

- `GET /health` — liveness
- `GET /health/ready` — readiness

## CI e deploy

- PR: validação na `develop` (lint, build, testes, auditoria de dependências com `audit-ci` e secret scan). O SonarCloud está temporariamente desabilitado (passos comentados no `pr-validation.yml`), a reativar no checkpoint 2.3 do runbook de implantação
- `main` + `environment: producao`: testes, `terraform apply` (pasta `terraform/`), imagem ECR por SHA, rollout EKS — ver `.github/workflows/deploy.yml`
- **Sem deploy automático a partir da `develop`**

## Cobertura

Threshold global **80 %** (statements, branches, functions, lines). Última medição local E25: branches 80,24 %.
