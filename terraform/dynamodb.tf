resource "aws_dynamodb_table" "tarefas" {
  name                        = "${local.name_prefix}-execution-tarefas"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "indiceFila"
    type = "S"
  }

  attribute {
    name = "indiceFilaOrdem"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi-fila-tarefas"
    hash_key        = "indiceFila"
    range_key       = "indiceFilaOrdem"
    projection_type = "ALL"
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

  attribute {
    name = "indicePublicacaoPendente"
    type = "S"
  }

  attribute {
    name = "indicePublicacaoPendenteOrdem"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi-publicacao-pendente"
    hash_key        = "indicePublicacaoPendente"
    range_key       = "indicePublicacaoPendenteOrdem"
    projection_type = "ALL"
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