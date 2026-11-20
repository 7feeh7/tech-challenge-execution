output "execution_in_queue_url" {
  description = "URL da fila de entrada do Execution"
  value       = aws_sqs_queue.execution_in.url
}

output "execution_in_queue_arn" {
  description = "ARN da fila de entrada do Execution"
  value       = aws_sqs_queue.execution_in.arn
}

output "execution_in_dlq_url" {
  description = "URL da DLQ do Execution"
  value       = aws_sqs_queue.execution_in_dlq.url
}

output "execution_in_dlq_arn" {
  description = "ARN da DLQ do Execution"
  value       = aws_sqs_queue.execution_in_dlq.arn
}

output "ecr_repository_url" {
  description = "URL do repositório ECR do Execution"
  value       = aws_ecr_repository.execution.repository_url
}

output "dynamodb_tarefas_table_name" {
  description = "Nome da tabela DynamoDB de tarefas"
  value       = aws_dynamodb_table.tarefas.name
}

output "dynamodb_outbox_table_name" {
  description = "Nome da tabela DynamoDB de outbox"
  value       = aws_dynamodb_table.outbox.name
}

output "dynamodb_outbox_table_arn" {
  description = "ARN da tabela DynamoDB de outbox"
  value       = aws_dynamodb_table.outbox.arn
}

output "dynamodb_outbox_gsi_publicacao_pendente_arn" {
  description = "ARN do GSI gsi-publicacao-pendente da outbox (Query nas pendentes; complemento E06)"
  value       = "${aws_dynamodb_table.outbox.arn}/index/gsi-publicacao-pendente"
}

output "dynamodb_tarefas_gsi_fila_arn" {
  description = "ARN do GSI gsi-fila-tarefas (complemento E06)"
  value       = "${aws_dynamodb_table.tarefas.arn}/index/gsi-fila-tarefas"
}

output "dynamodb_mensagens_processadas_table_name" {
  description = "Nome da tabela DynamoDB de mensagens processadas"
  value       = aws_dynamodb_table.mensagens_processadas.name
}