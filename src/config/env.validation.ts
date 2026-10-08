import * as Joi from 'joi';

/**
 * Validates environment variables at startup. The app refuses to boot
 * with missing or weak configuration instead of failing later at runtime.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .invalid(Joi.ref('JWT_ACCESS_SECRET'))
    .required()
    .messages({ 'any.invalid': '"JWT_REFRESH_SECRET" must differ from "JWT_ACCESS_SECRET"' }),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  CORS_ORIGIN: Joi.string().required(),

  THROTTLE_TTL: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),
  /** Stricter limit for login/register/refresh/logout (per IP, per route, per minute). */
  THROTTLE_AUTH_LIMIT: Joi.number().integer().positive().default(10),
});
