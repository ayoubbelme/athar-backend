import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, setupSwagger } from '../src/app.setup';

describe('Foundation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports app and database status', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
  });

  it('unknown routes return the standard error shape', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/does-not-exist',
    });
    expect(res.body.timestamp).toBeDefined();
  });

  it('sets security headers (helmet)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves the OpenAPI document with all module tags', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const tags = (res.body.tags as Array<{ name: string }>).map((t) => t.name);
    expect(tags).toEqual(
      expect.arrayContaining([
        'Auth',
        'Users',
        'Volunteers',
        'Organizations',
        'Skills',
        'Projects',
        'Applications',
        'Matching',
        'Impact',
        'Health',
      ]),
    );
    expect(res.body.components.securitySchemes['access-token']).toBeDefined();
  });

  it('allows configured CORS origin and rejects others', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:8081');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    const denied = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
