variable "project_name" {
  type        = string
  description = "Prefixo do projeto"
  default     = "tech-challenge"
}

variable "environment" {
  type        = string
  description = "Ambiente (producao)"
  default     = "producao"
}

variable "aws_region" {
  type        = string
  description = "Região AWS"
  default     = "us-east-1"
}

variable "sqs_max_receive_count" {
  type        = number
  description = "maxReceiveCount da fila principal"
  default     = 5
}

variable "sqs_visibility_timeout_seconds" {
  type        = number
  description = "Visibilidade maior que o processamento previsto"
  default     = 120
}