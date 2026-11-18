locals {
  ssm_prefix = "/tech-challenge/${var.environment}"
}

resource "aws_ssm_parameter" "execution_in_queue_url" {
  name  = "${local.ssm_prefix}/infra/execution_in_queue_url"
  type  = "String"
  value = aws_sqs_queue.execution_in.url
}

resource "aws_ssm_parameter" "execution_in_queue_arn" {
  name  = "${local.ssm_prefix}/infra/execution_in_queue_arn"
  type  = "String"
  value = aws_sqs_queue.execution_in.arn
}

resource "aws_ssm_parameter" "execution_in_dlq_url" {
  name  = "${local.ssm_prefix}/infra/execution_in_dlq_url"
  type  = "String"
  value = aws_sqs_queue.execution_in_dlq.url
}

resource "aws_ssm_parameter" "execution_ecr_repository_url" {
  name  = "${local.ssm_prefix}/infra/execution_ecr_repository_url"
  type  = "String"
  value = aws_ecr_repository.execution.repository_url
}