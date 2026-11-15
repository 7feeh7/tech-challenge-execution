# Mensagens do Execution Service

Dono: Execution (`tech-challenge-execution`). Canal: SQS fila `tech-challenge-producao-execution-in`.

Envelope comum conforme spec Fase 4 `05-communication.md` (não versionada).

Contratos financeiros não pertencem a este serviço.

---

## Comandos consumidos (entrada `execution-in`)

| eventType                          | Origem típica |
| ---------------------------------- | ------------- |
| `execution.iniciar-diagnostico.v1` | OS            |
| `execution.iniciar-reparo.v1`      | OS            |
| `execution.cancelar-tarefa.v1`     | OS            |

Exemplos em `exemplos/`.

---

## Eventos publicados

| eventType                              | Destino típico |
| -------------------------------------- | -------------- |
| `execution.diagnostico-iniciado.v1`    | OS             |
| `execution.tarefa-devolvida-a-fila.v1` | OS             |
| `execution.reparo-iniciado.v1`         | OS             |
| `execution.reparo-concluido.v1`        | OS             |
| `execution.reparo-falhou.v1`           | OS             |
| `execution.reparo-interrompido.v1`     | OS             |
| `execution.resposta-cancelamento.v1`   | OS             |

Exemplos em `exemplos/`.
