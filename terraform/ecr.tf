resource "aws_ecr_repository" "execution" {
  name                 = "${var.project_name}-execution-${var.environment}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-execution-${var.environment}"
  }
}

resource "aws_ecr_lifecycle_policy" "execution" {
  repository = aws_ecr_repository.execution.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Manter últimas 30 imagens"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}