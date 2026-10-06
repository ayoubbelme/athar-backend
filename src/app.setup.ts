import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppConfig } from './config/configuration';
import { API_DOCS_PATH, API_TAGS, BEARER_AUTH_NAME } from './common/constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Shared bootstrap logic. Used by main.ts and by e2e tests so tests run
 * against the exact same pipes/filters/security as production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());

  const origins = config.get('cors.origins', { infer: true });
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // reject them (mass-assignment protection)
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const document = new DocumentBuilder()
    .setTitle('ATHAR API')
    .setDescription('ATHAR | أثر — smart volunteering platform REST API')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, BEARER_AUTH_NAME);
  Object.values(API_TAGS).forEach((tag) => document.addTag(tag));

  SwaggerModule.setup(API_DOCS_PATH, app, SwaggerModule.createDocument(app, document.build()), {
    swaggerOptions: { persistAuthorization: true },
  });
}
