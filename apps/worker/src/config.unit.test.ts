import { parseWorkerConfig, WorkerConfigError } from './config';

const DEVELOPMENT_DATABASE_URL = 'postgresql://eonrover:eonrover_dev_password@localhost:5432/eonrover';

function productionEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://service_user:strong_password@db.example.com:5432/eonrover',
    REDIS_URL: 'rediss://cache_user:cache_password@cache.example.com:6380',
    WORKER_HEALTH_PORT: '4100',
    ...overrides,
  };
}

describe('parseWorkerConfig', () => {
  it('parses valid development configuration with intended local defaults', () => {
    const config = parseWorkerConfig({ DATABASE_URL: DEVELOPMENT_DATABASE_URL });

    expect(config).toEqual({
      environment: 'development',
      databaseUrl: DEVELOPMENT_DATABASE_URL,
      redisUrl: 'redis://localhost:6379',
      healthPort: 4100,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('parses valid test configuration after the Stage 0 guard supplies DATABASE_URL', () => {
    const testDatabaseUrl = 'postgresql://test_user:test_password@localhost:5432/eonrover_test';
    const config = parseWorkerConfig({
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
    expect(parseWorkerConfig(productionEnvironment())).toEqual({
      environment: 'production',
      databaseUrl: 'postgresql://service_user:strong_password@db.example.com:5432/eonrover',
      redisUrl: 'rediss://cache_user:cache_password@cache.example.com:6380',
      healthPort: 4100,
    });
  });

  it('rejects missing required production configuration', () => {
    expect(() => parseWorkerConfig(productionEnvironment({ REDIS_URL: undefined }))).toThrow(
      /REDIS_URL is required/,
    );
  });

  it('rejects unsupported environment modes and malformed URLs', () => {
    expect(() =>
      parseWorkerConfig({ NODE_ENV: 'preview', DATABASE_URL: DEVELOPMENT_DATABASE_URL }),
    ).toThrow(/NODE_ENV/);
    expect(() => parseWorkerConfig({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it.each(['not-a-number', '0', '65536'])('rejects invalid WORKER_HEALTH_PORT value %s', (port) => {
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: DEVELOPMENT_DATABASE_URL,
        WORKER_HEALTH_PORT: port,
      }),
    ).toThrow(/WORKER_HEALTH_PORT must be an integer between 1 and 65535/);
  });

  it('rejects local development endpoints in production', () => {
    expect(() =>
      parseWorkerConfig(productionEnvironment({ DATABASE_URL: DEVELOPMENT_DATABASE_URL })),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      parseWorkerConfig(productionEnvironment({ REDIS_URL: 'redis://localhost:6379' })),
    ).toThrow(/REDIS_URL/);
  });

  it('does not include secrets or complete URLs in errors', () => {
    const secretUrl = 'redis://secret_user:do-not-print@localhost:6379';
    let refusal: unknown;

    try {
      parseWorkerConfig(productionEnvironment({ REDIS_URL: secretUrl }));
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(WorkerConfigError);
    const message = (refusal as Error).message;
    expect(message).not.toContain('do-not-print');
    expect(message).not.toContain('secret_user');
    expect(message).not.toContain(secretUrl);
  });
});
