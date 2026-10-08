import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/** Separate file = fresh app = fresh rate-limit counters. */
describe('Auth brute-force protection (e2e)', () => {
  const previousLimit = process.env.THROTTLE_AUTH_LIMIT;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = '5';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = previousLimit;
    await app.close();
  });

  it('allows the configured number of login attempts, then returns 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@e2e.athar.test', password: 'WrongPassw0rd' });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429, 429]);
  });

  it('limits each auth route independently', async () => {
    // login is exhausted above (same app), but refresh has its own counter
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'x' });
    expect(res.status).toBe(401);
  });
});
