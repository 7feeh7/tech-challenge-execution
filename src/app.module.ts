import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { HealthModule } from './modules/health/health.module';
import { TarefasModule } from './modules/tarefas/tarefas.module';
import { DynamoDbModule } from './shared/database/dynamodb.module';
import { DomainExceptionFilter } from './shared/filters/domain-exception.filter';
import { MensageriaModule } from './shared/messaging/mensageria.module';
import { ObservabilityModule } from './shared/observability/observability.module';

@Module({
  imports: [
    ObservabilityModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DynamoDbModule,
    MensageriaModule,
    AuthModule,
    HealthModule,
    TarefasModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
  ],
})
export class AppModule {}
