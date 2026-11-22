# tech-challenge-execution

Execution Service da oficina mecânica: fila e execução das tarefas de diagnóstico e reparo do mecânico. Projeto do Tech Challenge (FIAP).

Na **Fase 4** é um dos seis repositórios independentes. O Execution recebe comandos do OS Service, que orquestra a SAGA, e devolve os fatos (diagnóstico iniciado, reparo concluído etc.).

## Tecnologias

| Tecnologia      | Uso                                        |
| --------------- | ------------------------------------------ |
| NestJS 11       | Framework, com Fastify                     |
| TypeScript      | Linguagem (Node.js 24)                     |
| Amazon DynamoDB | Tarefas, outbox e mensagens processadas    |
| Amazon SQS      | Comandos recebidos e fatos publicados      |
| Jest 30 + Biome | Testes e lint                              |
| Terraform       | Tabelas DynamoDB, fila `execution-in`, ECR |

## Arquitetura

- **Responsabilidade:** tarefas de diagnóstico e reparo, com rotas `/v1/tarefas...` (listar, iniciar, devolver à fila, concluir, falhar e interromper). O `MECANICO` só atua na tarefa em que é o responsável. Clean Architecture por módulo em `src/modules/`.
- **Deploy:** EKS, namespace `execution`, com `Deployment`, `HPA`, `Service` e `ServiceAccount` (IRSA) em `k8s/`. Não há `NetworkPolicy`: o isolamento vem de namespace, IAM/IRSA e credenciais próprias.
- **Banco:** DynamoDB, sem RDS. Tabelas `execution-tarefas` (índice `gsi-fila-tarefas`), `execution-outbox` (índice `gsi-publicacao-pendente`) e `execution-mensagens-processadas`, criadas em `terraform/`.
- **SAGA:** consome os comandos do OS na fila `execution-in` (com DLQ) e publica os fatos na fila `os-in` do OS. Não consome eventos do Billing. Também executa o cancelamento de tarefa pedido na compensação.
- **Outbox e idempotência:** fatos saem pela outbox no DynamoDB (Transactional Outbox) e o consumo é idempotente por `execution-mensagens-processadas`.
- **REST interno:** ao concluir o diagnóstico, chama o OS (`POST /internal/ordens-servico/:id/diagnostico`) com token de serviço e `Idempotency-Key`.
- **Borda:** o API Gateway expõe `/v1/tarefas*`. Autenticação por JWT RS256, validado só com a chave pública.
- **Observabilidade:** logs JSON coletados pelo Datadog Agent do cluster.

## Execução e desenvolvimento

Pré-requisitos: Node.js 24+ e Yarn 1.x. Os testes de integração e e2e precisam de DynamoDB local. Variáveis de referência em [`.env.example`](.env.example); no `.env.example` os processadores de SQS e outbox vêm desligados (`SQS_CONSUMER_HABILITADO` e `OUTBOX_PUBLISHER_HABILITADO` em `false`).

```bash
yarn install --frozen-lockfile
yarn start:dev
```

- Swagger: `GET /docs`
- Health: `GET /health` (liveness) e `GET /health/ready` (readiness)

Testes e qualidade:

```bash
yarn lint
yarn build
yarn test
yarn test:cov                                     # cobertura mínima de 80 %
export DYNAMODB_ENDPOINT=http://localhost:8000    # DynamoDB local
yarn test:int
yarn test:e2e
```

O CI (`pr-validation.yml`) roda auditoria de dependências (`audit-ci`), lint, build, cobertura, integração e e2e. Na `main`, `deploy.yml` aplica o Terraform, publica a imagem no ECR e faz o rollout no EKS. Não há deploy automático a partir da `develop`.

Na partida em produção, `validarConfiguracaoExecution()` exige JWT RS256, tokens do OS, filas, tabelas DynamoDB e prazos coerentes.

## Documentação

- Arquitetura do serviço: [`docs/arquitetura.md`](docs/arquitetura.md)
- Contratos de mensagens: [`docs/contratos/mensagens-execution.md`](docs/contratos/mensagens-execution.md)
- Prazos operacionais e pior caso: [`docs/prazos-operacionais.md`](docs/prazos-operacionais.md)
- Decisões (ADRs 008 a 015) e demais serviços: repositório `tech-challenge-oficina`
