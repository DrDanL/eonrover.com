import { RequestListener } from 'http';

const READINESS_TIMEOUT_MS = 1_000;

type DependencyCheck = () => Promise<unknown>;

export interface ReadinessChecks {
  database: DependencyCheck;
  redis: DependencyCheck;
}

interface HealthResponse {
  statusCode: number;
  body: { status: 'ok' | 'unavailable' | 'not_found' };
}

function runCheck(check: DependencyCheck, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(available);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);

    void Promise.resolve()
      .then(check)
      .then(() => finish(true), () => finish(false));
  });
}

export async function checkReadiness(
  checks: ReadinessChecks,
  timeoutMs = READINESS_TIMEOUT_MS,
): Promise<boolean> {
  const [database, redis] = await Promise.all([
    runCheck(checks.database, timeoutMs),
    runCheck(checks.redis, timeoutMs),
  ]);

  return database && redis;
}

export async function healthResponse(
  method: string | undefined,
  path: string | undefined,
  checks: ReadinessChecks,
  timeoutMs = READINESS_TIMEOUT_MS,
): Promise<HealthResponse> {
  if (method === 'GET' && path === '/healthz') {
    return { statusCode: 200, body: { status: 'ok' } };
  }
  if (method === 'GET' && path === '/readyz') {
    const ready = await checkReadiness(checks, timeoutMs);
    return { statusCode: ready ? 200 : 503, body: { status: ready ? 'ok' : 'unavailable' } };
  }
  return { statusCode: 404, body: { status: 'not_found' } };
}

export function createHealthHandler(checks: ReadinessChecks, timeoutMs = READINESS_TIMEOUT_MS): RequestListener {
  return (req, res) => {
    void healthResponse(req.method, req.url, checks, timeoutMs).then((response) => {
      res.writeHead(response.statusCode, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(response.body));
    });
  };
}
