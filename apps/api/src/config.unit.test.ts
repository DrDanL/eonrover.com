import { ApiConfigError, parseApiConfig } from './config';

const DEVELOPMENT_DATABASE_URL = 'postgresql://eonrover:eonrover_dev_password@localhost:5432/eonrover';

function productionEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://service_user:strong_password@db.example.com:5432/eonrover',
    REDIS_URL: 'rediss://cache_user:cache_password@cache.example.com:6380',
    PORT: '4000',
    WEB_URL: 'https://play.example.com',
    COOKIE_SECURE: 'true',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    MAIL_FROM: 'no-reply@example.com',
    ...overrides,
  };
}

describe('parseApiConfig', () => {
  it('parses valid development configuration with intended local defaults', () => {
    const config = parseApiConfig({ DATABASE_URL: DEVELOPMENT_DATABASE_URL });

    expect(config).toEqual({
      environment: 'development',
      databaseUrl: DEVELOPMENT_DATABASE_URL,
      redisUrl: 'redis://localhost:6379',
      port: 4000,
      webUrl: 'http://localhost:3000',
      secureCookies: false,
      smtp: {
        host: 'localhost',
        port: 1025,
        from: 'no-reply@eonrover.com',
        requireTls: false,
      },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.smtp)).toBe(true);
  });

  it('parses valid test configuration after the Stage 0 guard supplies DATABASE_URL', () => {
    const testDatabaseUrl = 'postgresql://test_user:test_password@localhost:5432/eonrover_test';
    const config = parseApiConfig({
      NODE_ENV: 'test',
      TEST_DATABASE_URL: testDatabaseUrl,
      ALLOW_TEST_DATABASE_RESET: '1',
      DATABASE_URL: testDatabaseUrl,
    });

    expect(config.environment).toBe('test');
    expect(config.databaseUrl).toBe(testDatabaseUrl);
    expect(config.redisUrl).toBe('redis://localhost:6379/15');
  });

  it('parses valid production configuration', () => {
    const config = parseApiConfig(productionEnvironment());

    expect(config.environment).toBe('production');
    expect(config.webUrl).toBe('https://play.example.com');
    expect(config.secureCookies).toBe(true);
    expect(config.smtp).toEqual({
      host: 'smtp.example.com',
      port: 587,
      from: 'no-reply@example.com',
      requireTls: true,
    });
  });

  it('rejects a missing required production variable', () => {
    expect(() => parseApiConfig(productionEnvironment({ REDIS_URL: undefined }))).toThrow(
      /REDIS_URL is required/,
    );
    expect(() => parseApiConfig(productionEnvironment({ SMTP_PORT: undefined }))).toThrow(
      /SMTP_PORT is required/,
    );
  });

  it('rejects an unsupported environment mode', () => {
    expect(() =>
      parseApiConfig({ NODE_ENV: 'staging', DATABASE_URL: DEVELOPMENT_DATABASE_URL }),
    ).toThrow(/NODE_ENV must be development, test, or production/);
  });

  it('rejects malformed and unsupported URLs', () => {
    expect(() => parseApiConfig({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
    expect(() => parseApiConfig({ DATABASE_URL: 'mysql://localhost/eonrover' })).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid mail sender', () => {
    expect(() => parseApiConfig({ DATABASE_URL: DEVELOPMENT_DATABASE_URL, MAIL_FROM: 'not-an-address' })).toThrow(
      /MAIL_FROM/,
    );
  });

  it.each(['not-a-number', '1.5'])('rejects non-integer PORT value %s', (port) => {
    expect(() => parseApiConfig({ DATABASE_URL: DEVELOPMENT_DATABASE_URL, PORT: port })).toThrow(
      /PORT must be an integer between 1 and 65535/,
    );
  });

  it('rejects ports below 1', () => {
    expect(() => parseApiConfig({ DATABASE_URL: DEVELOPMENT_DATABASE_URL, PORT: '0' })).toThrow(
      /PORT must be an integer between 1 and 65535/,
    );
  });

  it('rejects ports above 65535', () => {
    expect(() => parseApiConfig({ DATABASE_URL: DEVELOPMENT_DATABASE_URL, PORT: '65536' })).toThrow(
      /PORT must be an integer between 1 and 65535/,
    );
  });

  it('rejects local development endpoints and insecure cookies in production', () => {
    expect(() =>
      parseApiConfig(productionEnvironment({ DATABASE_URL: DEVELOPMENT_DATABASE_URL })),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      parseApiConfig(productionEnvironment({ REDIS_URL: 'redis://localhost:6379' })),
    ).toThrow(/REDIS_URL/);
    expect(() =>
      parseApiConfig(productionEnvironment({ WEB_URL: 'http://localhost:3000' })),
    ).toThrow(/WEB_URL/);
    expect(() =>
      parseApiConfig(productionEnvironment({ COOKIE_SECURE: 'false' })),
    ).toThrow(/COOKIE_SECURE/);
    expect(() =>
      parseApiConfig(productionEnvironment({ SMTP_HOST: 'mailpit', SMTP_PORT: '1025' })),
    ).toThrow(/SMTP_HOST/);
    expect(() =>
      parseApiConfig(productionEnvironment({ SMTP_PORT: '1025' })),
    ).toThrow(/SMTP_PORT/);
  });

  it('does not include secrets or complete URLs in errors', () => {
    const secretUrl = 'postgresql://secret_user:do-not-print@db.example.com:5432/';
    let refusal: unknown;

    try {
      parseApiConfig(productionEnvironment({ DATABASE_URL: secretUrl }));
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ApiConfigError);
    const message = (refusal as Error).message;
    expect(message).not.toContain('do-not-print');
    expect(message).not.toContain('secret_user');
    expect(message).not.toContain('db.example.com');
    expect(message).not.toContain(secretUrl);
  });
});
