export type EnvironmentMode = 'development' | 'test' | 'production';

export type Environment = Readonly<Record<string, string | undefined>>;

export interface ApiConfig {
  readonly environment: EnvironmentMode;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly port: number;
  readonly webUrl: string;
  readonly secureCookies: boolean;
  readonly smtp: Readonly<{
    host: string;
    port: number;
    from: string;
    requireTls: boolean;
  }>;
}

export class ApiConfigError extends Error {
  constructor(variable: string, reason: string) {
    super(`Invalid API configuration: ${variable} ${reason}.`);
    this.name = 'ApiConfigError';
  }
}

const SUPPORTED_ENVIRONMENTS = new Set<EnvironmentMode>(['development', 'test', 'production']);
const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const REDIS_PROTOCOLS = new Set(['redis:', 'rediss:']);

function invalid(variable: string, reason: string): never {
  throw new ApiConfigError(variable, reason);
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

function parseBoolean(variable: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  invalid(variable, 'must equal true or false');
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

function validateSmtpHost(value: string): string {
  if (value !== value.trim() || /[\s/@?#]/.test(value)) {
    invalid('SMTP_HOST', 'must be a hostname without a protocol or port');
  }
  let parsed: URL;
  try {
    parsed = new URL(`smtp://${value}`);
  } catch {
    invalid('SMTP_HOST', 'must be a valid hostname');
  }
  if (!parsed.hostname || parsed.port) invalid('SMTP_HOST', 'must be a valid hostname');
  return value;
}

function validateMailFrom(value: string): string {
  if (value !== value.trim() || /[\r\n]/.test(value)) {
    invalid('MAIL_FROM', 'must be a non-empty mail sender without surrounding whitespace or line breaks');
  }
  const displayAddress = /^[^<>]+<([^<>\s]+)>$/.exec(value);
  const address = displayAddress?.[1] ?? value;
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) {
    invalid('MAIL_FROM', 'must contain a valid email address');
  }
  return value;
}

export function parseApiConfig(environment: Environment): Readonly<ApiConfig> {
  const mode = parseEnvironment(environment.NODE_ENV);
  const production = mode === 'production';

  const databaseUrl = required(environment, 'DATABASE_URL');
  const parsedDatabase = parseDatabaseUrl(databaseUrl);

  const localRedisUrl = mode === 'test' ? 'redis://localhost:6379/15' : 'redis://localhost:6379';
  const redisUrl = production ? required(environment, 'REDIS_URL') : environment.REDIS_URL || localRedisUrl;
  const parsedRedis = parseUrl('REDIS_URL', redisUrl, REDIS_PROTOCOLS);

  const webUrlValue =
    production ? required(environment, 'WEB_URL') : environment.WEB_URL || 'http://localhost:3000';
  const parsedWebUrl = parseUrl('WEB_URL', webUrlValue, new Set(['http:', 'https:']));
  if (
    parsedWebUrl.username ||
    parsedWebUrl.password ||
    parsedWebUrl.pathname !== '/' ||
    parsedWebUrl.search ||
    parsedWebUrl.hash
  ) {
    invalid('WEB_URL', 'must be an HTTP(S) origin without credentials, a path, query, or fragment');
  }

  const secureCookies = parseBoolean('COOKIE_SECURE', environment.COOKIE_SECURE, production);
  const smtpHost = validateSmtpHost(
    production ? required(environment, 'SMTP_HOST') : environment.SMTP_HOST || 'localhost',
  );
  const smtpPort = parsePort(
    'SMTP_PORT',
    production ? required(environment, 'SMTP_PORT') : environment.SMTP_PORT,
    1025,
  );
  const mailFrom = validateMailFrom(
    production ? required(environment, 'MAIL_FROM') : environment.MAIL_FROM || 'no-reply@eonrover.com',
  );

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
    if (parsedWebUrl.protocol !== 'https:' || isLoopback(parsedWebUrl.hostname)) {
      invalid('WEB_URL', 'must be a non-loopback HTTPS origin in production');
    }
    if (!secureCookies) invalid('COOKIE_SECURE', 'must be true in production');
    if (isLoopback(smtpHost) || normalizedHostname(smtpHost) === 'mailpit') {
      invalid('SMTP_HOST', 'must not select the local Mailpit endpoint in production');
    }
    if (smtpPort === 1025) invalid('SMTP_PORT', 'must not select the local Mailpit port in production');
    if (smtpPort === 465) invalid('SMTP_PORT', 'must use a STARTTLS port rather than implicit TLS port 465');
  }

  const smtp = Object.freeze({ host: smtpHost, port: smtpPort, from: mailFrom, requireTls: production });
  return Object.freeze({
    environment: mode,
    databaseUrl,
    redisUrl,
    port: parsePort('PORT', environment.PORT, 4000),
    webUrl: parsedWebUrl.origin,
    secureCookies,
    smtp,
  });
}

let cachedConfig: Readonly<ApiConfig> | undefined;

export function getApiConfig(): Readonly<ApiConfig> {
  cachedConfig ??= parseApiConfig(process.env);
  return cachedConfig;
}

if (require.main === module) getApiConfig();
