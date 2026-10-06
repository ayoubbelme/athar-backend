import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { API_TAGS } from '../common/constants';
import { HealthReport, HealthService } from './health.service';

@ApiTags(API_TAGS.HEALTH)
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + database connectivity check' })
  @ApiResponse({
    status: 200,
    description: 'Application and database are healthy',
    schema: {
      example: {
        status: 'ok',
        database: 'connected',
        uptime: 120,
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 503, description: 'Database unreachable' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
