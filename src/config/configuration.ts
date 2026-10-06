export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  database: { url: string };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  cors: { origins: string[] };
  throttle: { ttlSeconds: number; limit: number };
}

/** Maps validated environment variables to a typed, namespaced config object. */
export const configuration = (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV as AppConfig['nodeEnv'],
  port: Number(process.env.PORT),
  logLevel: process.env.LOG_LEVEL as string,
  database: { url: process.env.DATABASE_URL as string },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN as string,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN as string,
  },
  cors: {
    origins: (process.env.CORS_ORIGIN as string)
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  throttle: {
    ttlSeconds: Number(process.env.THROTTLE_TTL),
    limit: Number(process.env.THROTTLE_LIMIT),
  },
});
