import { Global, Module } from '@nestjs/common';
import { JsonLoggerService } from './json-logger.service';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  providers: [JsonLoggerService, MetricsService],
  exports: [JsonLoggerService, MetricsService],
})
export class ObservabilityModule {}
