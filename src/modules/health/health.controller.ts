import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness: o processo está de pé' })
  @ApiResponse({ status: 200, description: 'Aplicação viva.' })
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: a aplicação consegue atender' })
  @ApiResponse({ status: 200, description: 'Pronta para receber tráfego.' })
  readiness() {
    return { status: 'ok' };
  }
}
