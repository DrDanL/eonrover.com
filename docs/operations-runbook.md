# Operations runbook

## Health probes

`GET /healthz` is a process liveness probe. It returns `{"status":"ok"}` without contacting PostgreSQL or Redis.

`GET /readyz` is a bounded dependency readiness probe. It returns `{"status":"ok"}` only when the service can use both PostgreSQL and Redis; otherwise it returns `503 {"status":"unavailable"}`. Neither response identifies a dependency, host, queue, version, or connection detail.

## Safe deployment sequence

1. Confirm that a current backup exists; this runbook does not claim a restore rehearsal.
2. Inspect migration status and apply the reviewed migrations.
3. Restart the API and worker.
4. Check API and worker readiness.
5. Observe structured worker queue-registration and reconciliation events. PostgreSQL is authoritative; Redis/BullMQ only supplies recoverable wake-ups.

## Recovery

- If readiness fails, correct the service configuration or dependency, then restart and recheck readiness. Do not rely on a liveness response as proof of dependency health.
- If a migration fails, stop the deployment, preserve the failed migration state for investigation, and use the approved database recovery procedure before retrying. Do not manually edit the migration ledger.
- If a deterministic wake-up is missing, restore the dependency and let the relevant startup/30-second canonical reconciler restore it from PostgreSQL. Do not invent a job payload from logs.

## Logging and support boundaries

Operational events carry only event names, queue/reconciliation labels, and safe aggregate counts. Do not put database or Redis URLs, passwords, tokens, cookies, session IDs, email credentials, player resources, manifests, combat seeds, reports, or target details in logs or support tickets.
