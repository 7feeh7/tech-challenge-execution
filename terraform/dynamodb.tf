resource "aws_dynamodb_table" "tarefas" {
  name                        = "${local.name_prefix}-execution-tarefas"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  tags = {
    Name = "${local.name_prefix}-execution-tarefas"
  }
}

resource "aws_dynamodb_table" "outbox" {
  name                        = "${local.name_prefix}-execution-outbox"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "eventId"
  deletion_protection_enabled = true

  attribute {
    name = "eventId"
    type = "S"
  }

  tags = {
    Name = "${local.name_prefix}-execution-outbox"
  }
}

resource "aws_dynamodb_table" "mensagens_processadas" {
  name                        = "${local.name_prefix}-execution-mensagens-processadas"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "eventId"
  deletion_protection_enabled = true

  attribute {
    name = "eventId"
    type = "S"
  }

  tags = {
    Name = "${local.name_prefix}-execution-mensagens-processadas"
  }
}