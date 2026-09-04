export type EnvironmentMode = 'development' | 'test' | 'production';

export type Environment = Readonly<Record<string, string | undefined>>;

export interface WorkerConfig {
  readonly environment: EnvironmentMode;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly healthPort: number;
}

export class WorkerConfigError extends Error {
  constructor(variable: string, reason: string) {
    super(`Invalid worker configuration: ${variable} ${reason}.`);
    this.name = 'WorkerConfigError';
  }
}

const SUPPORTED_ENVIRONMENTS = new Set<EnvironmentMode>(['development', 'test', 'production']);
const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const REDIS_PROTOCOLS = new Set(['redis:', 'rediss:']);

function invalid(variable: string, reason: string): never {
  throw new WorkerConfigError(variable, reason);
}

function parseEnvironment(value: string | undefined): EnvironmentMode {
  if (value === undefined || value === '') return 'development';
  if (!SUPPORTED_ENVIRONMENTS.has(value as EnvironmentMode)) {
    invalid('NODE_ENV', 'must be development, test, or production');
  }
  return value as EnvironmentMode;
}

function required(environment: Environment, variable: string): string {
  const value = environment[variable];
  if (value === undefined || value === '' || value !== value.trim()) {
    invalid(variable, 'is required and must not contain surrounding whitespace');
  }
  return value;
}

function parsePort(variable: string, value: string | undefined, fallback: number): number {
  const candidate = value === undefined || value === '' ? String(fallback) : value;
  if (!/^\d+$/.test(candidate)) invalid(variable, 'must be an integer between 1 and 65535');
  const port = Number(candidate);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    invalid(variable, 'must be an integer between 1 and 65535');
  }
  return port;
}

function parseUrl(variable: string, value: string, protocols: ReadonlySet<string>): URL {
  if (value !== value.trim()) invalid(variable, 'must be a valid URL without surrounding whitespace');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid(variable, 'must be a valid URL');
  }
  if (!protocols.has(parsed.protocol) || !parsed.hostname) {
    invalid(variable, 'must use a supported protocol and include a host');
  }
  return parsed;
}

function parseDatabaseUrl(value: string): URL {
  const parsed = parseUrl('DATABASE_URL', value, POSTGRES_PROTOCOLS);
  const encodedName = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : '';
  let databaseName = '';
  try {
    databaseName = decodeURIComponent(encodedName);
  } catch {
    invalid('DATABASE_URL', 'must contain a valid database name');
  }
  if (
    !databaseName ||
    databaseName !== databaseName.trim() ||
    databaseName.includes('/') ||
    databaseName.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(databaseName)
  ) {
    invalid('DATABASE_URL', 'must contain one unambiguous database name');
  }
  return parsed;
}

function decodeDatabasePassword(parsed: URL): string {
  try {
    return decodeURIComponent(parsed.password);
  } catch {
    invalid('DATABASE_URL', 'must contain valid credential encoding');
  }
}

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isLoopback(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized.startsWith('127.')
  );
}

export function parseWorkerConfig(environment: Environment): Readonly<WorkerConfig> {
  const mode = parseEnvironment(environment.NODE_ENV);
  const production = mode === 'production';

  const databaseUrl = required(environment, 'DATABASE_URL');
  const parsedDatabase = parseDatabaseUrl(databaseUrl);
  const localRedisUrl = mode === 'test' ? 'redis://localhost:6379/15' : 'redis://localhost:6379';
  const redisUrl = production ? required(environment, 'REDIS_URL') : environment.REDIS_URL || localRedisUrl;
  const parsedRedis = parseUrl('REDIS_URL', redisUrl, REDIS_PROTOCOLS);

  if (production) {
    const databasePassword = decodeDatabasePassword(parsedDatabase);
    if (
      isLoopback(parsedDatabase.hostname) ||
      normalizedHostname(parsedDatabase.hostname) === 'postgres' ||
      databasePassword === 'eonrover_dev_password'
    ) {
      invalid('DATABASE_URL', 'must not use the documented local-development endpoint or credentials in production');
    }
    if (isLoopback(parsedRedis.hostname) || normalizedHostname(parsedRedis.hostname) === 'redis') {
      invalid('REDIS_URL', 'must not use a local-development endpoint in production');
    }
  }

  return Object.freeze({
    environment: mode,
    databaseUrl,
    redisUrl,
    healthPort: parsePort('WORKER_HEALTH_PORT', environment.WORKER_HEALTH_PORT, 4100),
  });
}

let cachedConfig: Readonly<WorkerConfig> | undefined;

export function getWorkerConfig(): Readonly<WorkerConfig> {
  cachedConfig ??= parseWorkerConfig(process.env);
  return cachedConfig;
}

if (require.main === module) getWorkerConfig();
