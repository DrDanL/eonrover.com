import { Router } from 'express';

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

export function createHealthRouter(checks: ReadinessChecks, timeoutMs = READINESS_TIMEOUT_MS): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/readyz', (_req, res) => {
    void checkReadiness(checks, timeoutMs).then((result) => {
      res.status(result.status === 'ready' ? 200 : 503).json(result);
    });
  });

  return router;
}
