import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Public } from '../src/common/decorators/public.decorator';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/** Test-only route: proves the global ThrottlerGuard protects every non-exempt endpoint. */
@Public()
@Controller('__throttle-probe')
class ThrottleProbeController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  const previousLimit = process.env.THROTTLE_LIMIT;

  beforeAll(async () => {
    process.env.THROTTLE_LIMIT = '3';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ThrottleProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    process.env.THROTTLE_LIMIT = previousLimit;
    await app.close();
  });

  it('returns 429 with the standard error shape after the limit is exceeded', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 3; i++) {
      await request(server).get('/__throttle-probe').expect(200);
    }
    const res = await request(server).get('/__throttle-probe').expect(429);
    expect(res.body).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
  });

  it('never throttles /health (orchestrator probes)', async () => {
    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  });
});
