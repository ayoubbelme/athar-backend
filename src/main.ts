import { Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { API_DOCS_PATH } from './common/constants';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);

  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const isProd = config.get('nodeEnv', { infer: true }) === 'production';
  // Interactive docs are convenient in dev; expose in production only deliberately.
  if (!isProd) setupSwagger(app);

  const port = config.get('port', { infer: true });
  await app.listen(port);

  const logger = new NestLogger('Bootstrap');
  logger.log(`ATHAR API listening on port ${port} (${config.get('nodeEnv', { infer: true })})`);
  if (!isProd) logger.log(`Swagger docs: http://localhost:${port}/${API_DOCS_PATH}`);
}

void bootstrap();
