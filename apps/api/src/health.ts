import { Router } from 'express';

const READINESS_TIMEOUT_MS = 1_000;

type DependencyCheck = () => Promise<unknown>;

export interface ReadinessChecks {
  database: DependencyCheck;
  redis: DependencyCheck;
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

export function createHealthRouter(checks: ReadinessChecks, timeoutMs = READINESS_TIMEOUT_MS): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/readyz', (_req, res) => {
    void checkReadiness(checks, timeoutMs).then((ready) => {
      res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
    });
  });

  return router;
}
