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

### Campos aditivos de reparo (D2.18 revisada, `v1`)

Nos fatos `execution.reparo-concluido.v1`, `execution.reparo-falhou.v1` e `execution.reparo-interrompido.v1`:

| Campo                          | Regra                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `payload.responsavelId`        | Mecânico autenticado que executou a operação (conclusão, falha ou interrupção) |
| `divergencias[].tipo`          | `CONSUMO_INFERIOR`, `CONSUMO_ZERO`, `CONSUMO_ACIMA`, `FORA_DA_LISTA`           |
| `divergencias[].justificativa` | Obrigatória em `CONSUMO_ACIMA` e `FORA_DA_LISTA`; opcional nas demais          |

Mensagens anteriores sem esses campos permanecem válidas (D3.12).

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
