import { envValidationSchema } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  CORS_ORIGIN: 'http://localhost:8081',
};

describe('env validation', () => {
  it('accepts a valid environment and applies defaults', () => {
    const { error, value } = envValidationSchema.validate(valid);
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      PORT: 3000,
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });
  });

  it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CORS_ORIGIN'])(
    'requires %s',
    (key) => {
      const env: Record<string, string> = { ...valid };
      delete env[key];
      expect(envValidationSchema.validate(env).error).toBeDefined();
    },
  );

  it('rejects short JWT secrets', () => {
    expect(
      envValidationSchema.validate({ ...valid, JWT_ACCESS_SECRET: 'short' }).error,
    ).toBeDefined();
  });

  it('rejects identical access and refresh secrets', () => {
    const same = { ...valid, JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET };
    expect(envValidationSchema.validate(same).error?.message).toContain('must differ');
  });

  it('rejects non-postgres database URLs', () => {
    expect(
      envValidationSchema.validate({ ...valid, DATABASE_URL: 'mysql://x/y' }).error,
    ).toBeDefined();
  });
});
