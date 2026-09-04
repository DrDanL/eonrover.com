import { RequestListener } from 'http';

const READINESS_TIMEOUT_MS = 1_000;

type CheckStatus = 'ok' | 'unavailable';
type DependencyCheck = () => Promise<unknown>;

export interface ReadinessChecks {
  database: DependencyCheck;
  redis: DependencyCheck;
}

interface ReadinessResult {
  status: 'ready' | 'not_ready';
  checks: {
    database: CheckStatus;
    redis: CheckStatus;
  };
}

interface HealthResponse {
  statusCode: number;
  body: { status: 'ok' | 'not_found' } | ReadinessResult;
}

function runCheck(check: DependencyCheck, timeoutMs: number): Promise<CheckStatus> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status: CheckStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(status);
    };
    const timeout = setTimeout(() => finish('unavailable'), timeoutMs);

    void Promise.resolve()
      .then(check)
      .then(() => finish('ok'), () => finish('unavailable'));
  });
}

export async function checkReadiness(
  checks: ReadinessChecks,
  timeoutMs = READINESS_TIMEOUT_MS,
): Promise<ReadinessResult> {
  const [database, redis] = await Promise.all([
    runCheck(checks.database, timeoutMs),
    runCheck(checks.redis, timeoutMs),
  ]);

  return {
    status: database === 'ok' && redis === 'ok' ? 'ready' : 'not_ready',
    checks: { database, redis },
  };
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
    const result = await checkReadiness(checks, timeoutMs);
    return { statusCode: result.status === 'ready' ? 200 : 503, body: result };
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
