# Eon Rover

Eon Rover is a browser-based, persistent multiplayer space strategy game inspired by classic
"build and battle" titles, with its own resources, terminology and mechanics. Players start with
a single undeveloped planet in the Eon Reach and grow an interplanetary civilisation by producing
resources, constructing buildings, researching technology, building fleets, exploring, colonising
and fighting (or allying with) other commanders.

* **Alloy** — building, defence and hull material.
* **Heliox** — energy and propulsion fuel.
* **Aether** — advanced research and rare technology.

An original differentiating mechanic, **Eon Gates**, lets players who recover enough Gate Fragments
from exploration missions activate ancient gateways and link two of their own planets for
near-instant fleet travel between them.

## Architecture

This is an npm-workspaces monorepo:

| Path                | Description                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `packages/shared`    | Game constants, types and pure formulas (resources, combat, travel, etc.) shared by the API and worker. |
| `apps/api`           | Express + Prisma REST API: auth, planets, buildings, research, shipyard, fleet, galaxy, gates, alliances, messages, leaderboard, notifications, reports, admin. |
| `apps/worker`        | BullMQ background worker that resolves build/research/shipyard/fleet queues (including combat, colonisation, espionage, recycling and exploration) once their timers elapse. |
| `apps/web`           | Next.js frontend: public marketing site (landing, features, guide, news, stats, leaderboard, auth) and the authenticated player/admin application. |

Data flows through PostgreSQL (via Prisma) for persistent state and Redis (via BullMQ) for
timed/queued events, so server-authoritative timers keep progressing even while players are
offline. Mailpit provides a local SMTP sink for verification and password-reset emails.

## Prerequisites

* [Docker](https://www.docker.com/) and Docker Compose, **or**
* Node.js 20+, a local PostgreSQL 16 instance and a local Redis 7 instance for running the apps directly.

## Local development with Docker Compose

`docker-compose.yml` is a local-development stack. It is not a production deployment template.

```bash
cp .env.example .env
# Edit .env if you want different credentials; the defaults work out of the box.
docker compose up --build
```

This builds and starts Postgres, Redis, Mailpit, the API, the worker and the web app, applying
database migrations and seeding a single admin account (from `ADMIN_EMAIL`/`ADMIN_USERNAME`/
`ADMIN_PASSWORD` in `.env`) automatically on first boot.

Once every service reports healthy:

* Web app: <http://localhost:3000>
* API: <http://localhost:4000> (`/healthz` for liveness and `/readyz` for readiness)
* Mailpit web UI (view outbound verification/reset emails): <http://localhost:8025>

Stop everything with `docker compose down` (add `-v` to also drop the database/redis volumes).

## Local development (without Docker)

1. Install dependencies once for every workspace:

   ```bash
   npm install
   ```

2. Start Postgres, Redis and Mailpit yourself (for example with `docker compose up postgres redis mailpit`),
   then export the matching environment variables (see `.env.example`) in each terminal below.
   Direct host processes need a PostgreSQL `DATABASE_URL` and should use
   `REDIS_URL=redis://localhost:6379` and `SMTP_HOST=localhost`; the `redis` and `mailpit`
   hostnames in `.env.example` are for Compose.

3. Apply database migrations:

   ```bash
   npm run build --workspace @eonrover/shared
   cd apps/api && npx prisma migrate deploy && cd ../..
   ```

4. Run each app in its own terminal (all support hot reload):

   ```bash
   npm run dev --workspace @eonrover/api     # http://localhost:4000
   npm run dev --workspace @eonrover/worker  # processes queued jobs
   npm run dev --workspace @eonrover/web     # http://localhost:3000
   ```

## Runtime configuration

The API and worker parse their environment once into typed, immutable configuration before they
create Prisma, Redis, BullMQ, SMTP, or HTTP-listener resources. Invalid configuration stops startup
with an error that names the environment variable but does not print its value.

`NODE_ENV` supports only `development`, `test`, and `production`; omitting it selects
`development`. Numeric ports must be integers from 1 through 65535.

| Variable | Used by | Development/test behaviour | Production behaviour |
| --- | --- | --- | --- |
| `DATABASE_URL` | API, worker | Required PostgreSQL URL. In tests, Stage 0 assigns the validated `TEST_DATABASE_URL` before runtime configuration is read. | Required; local Compose endpoints and the documented development password are rejected. |
| `REDIS_URL` | API, worker | Development defaults to `redis://localhost:6379`; test mode defaults to logical database 15 at `redis://localhost:6379/15`; Compose supplies `redis://redis:6379`. | Required; loopback and the local `redis` service hostname are rejected. |
| `PORT` | API | Defaults to `4000`. | Defaults to `4000`. |
| `WEB_URL` | API | Defaults to `http://localhost:3000`. Must be an HTTP(S) origin, without credentials or a path. | Required non-loopback HTTPS origin. |
| `COOKIE_SECURE` | API | Defaults to `false`; accepts only `true` or `false`. | Defaults to `true`; `false` is rejected. |
| `SMTP_HOST` | API | Defaults to local `localhost`; Compose supplies `mailpit`. | Required; loopback and `mailpit` are rejected. |
| `SMTP_PORT` | API | Defaults to Mailpit port `1025`. | Required; Mailpit port `1025` is rejected. |
| `MAIL_FROM` | API | Defaults to `no-reply@eonrover.com`. | Required. |
| `WORKER_HEALTH_PORT` | worker | Defaults to `4100`. | Defaults to `4100`. |

The existing mail transport accepts a host, port, and sender. Production mode requires STARTTLS;
implicit-TLS port `465` is rejected because the current transport is configured for STARTTLS.
The app does not currently expose SMTP credentials, so a production deployment must use a trusted
relay compatible with unauthenticated STARTTLS until authenticated SMTP is designed as separate
mail-system work.

## Operational probes

The API and the worker health server expose `GET /healthz` for dependency-free process liveness and
`GET /readyz` for readiness. Readiness checks the existing PostgreSQL and Redis connections in
parallel, bounds each check to approximately one second, and reports only `ok` or `unavailable`.
The worker serves these probes on `WORKER_HEALTH_PORT`. Docker Compose uses `/readyz` for the API and
worker container health checks so dependent services wait for usable dependencies, while operators
can still use `/healthz` to distinguish a live process from an unavailable dependency.

SMTP is intentionally excluded: database access and Redis-backed queue access are required for the
services' current request and job-processing responsibilities, while mail delivery remains separate
from account creation and is outside the readiness contract at this stage.

## Testing

Unit tests do not connect to PostgreSQL and never delete application data. Run all safe unit tests
(the database-safety guard, runtime configuration and health probes, and shared game formulas) from the
repository root:

```bash
npm run test:unit
```

The API and worker suites are integration tests. They deliberately erase application rows before
each test, so they will run only when all of these conditions are met:

* `TEST_DATABASE_URL` is explicitly provided; `DATABASE_URL` is never a fallback.
* `ALLOW_TEST_DATABASE_RESET` equals exactly `1`.
* The decoded PostgreSQL database name ends with `_test` and is not an administrative database.

Never supply development, staging, or production credentials as `TEST_DATABASE_URL`.

### Create and migrate the isolated test database

Use a second database in the existing PostgreSQL service. With the development defaults from
`.env.example`, start the existing infrastructure and create the database once:

```bash
docker compose up -d postgres redis mailpit
docker compose exec postgres sh -c 'createdb --username "$POSTGRES_USER" eonrover_test'
```

If `eonrover_test` already exists, the second command can be skipped. Export the test-only URL and
explicit reset opt-in in the shell that will run migrations and tests:

```bash
export TEST_DATABASE_URL='postgresql://eonrover:eonrover_dev_password@localhost:5432/eonrover_test'
export ALLOW_TEST_DATABASE_RESET=1
```

If you changed the development credentials or host port, adjust this test-only URL while keeping a
dedicated database name that ends in `_test`. Apply migrations to that exact URL; do not run the
application seed:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:migrate:deploy --workspace @eonrover/api
```

### Run integration tests

With those exports still present, run the suites separately:

```bash
npm run test:integration:api
npm run test:integration:worker
```

Or run both integration suites:

```bash
npm run test:integration
```

The API suite exercises real routes. The worker suite exercises fleet mission resolution and needs
Redis for follow-up jobs; unless `REDIS_URL` is explicitly set, test mode uses Redis logical
database 15 to avoid development queues. Both suites erase rows only inside the validated isolated test database.
Missing or unsafe test configuration fails before Prisma is initialized or cleanup becomes
reachable; integration tests no longer silently skip.

To run unit and integration tests together after migrating the isolated database:

```bash
npm test
```

Build verification remains a separate command:

```bash
npm run build
```

## Linting

```bash
npm run lint
```

## Backups

The only persistent state that must be backed up is the Postgres volume (`postgres_data` in
`docker-compose.yml`). A simple logical backup while the stack is running:

```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
```

Restore into a fresh database with:

```bash
cat backup.sql | docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

Redis only holds transient job-queue state (already-processed jobs are removed on completion) and
Mailpit only holds local dev/test email captures, so neither needs to be backed up.

## Production deployment

This repository does not yet provide a production orchestration template. Do not deploy
`docker-compose.yml`: it intentionally exposes local PostgreSQL, Redis, and Mailpit services and
uses development credentials.

A production platform must provide the variables marked required above, set
`NODE_ENV=production`, use non-local PostgreSQL/Redis/SMTP endpoints, and terminate HTTPS in front
of the web and API services. The API container validates its full runtime configuration before it
applies migrations, runs the optional administrator seed, or starts the HTTP listener. The worker
validates before creating its database client, Redis connection, queues, workers, or health
listener.

## Environment variables

See [`.env.example`](./.env.example) for the local Compose values and test-database convention.
It is deliberately a development template and must not be reused as production configuration.
 
