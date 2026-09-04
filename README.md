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

## Quick start (Docker)

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
* API: <http://localhost:4000> (`/healthz` for a liveness check)
* Mailpit web UI (view outbound verification/reset emails): <http://localhost:8025>

Stop everything with `docker compose down` (add `-v` to also drop the database/redis volumes).

## Local development (without Docker)

1. Install dependencies once for every workspace:

   ```bash
   npm install
   ```

2. Start Postgres, Redis and Mailpit yourself (for example with `docker compose up postgres redis mailpit`),
   then export the matching environment variables (see `.env.example`) — at minimum `DATABASE_URL`
   and `REDIS_URL` — in each terminal you use below.

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

## Testing

* `packages/shared` has fast, dependency-free unit tests for the game formulas (production,
  travel time, fuel, espionage accuracy, combat resolution):

  ```bash
  npm run test --workspace @eonrover/shared
  ```

* `apps/api` and `apps/worker` have Jest + Supertest integration tests that exercise real routes,
  the database and (for the worker) fleet-mission resolution (transport, combat, colonisation, gate
  travel). They automatically skip themselves if `DATABASE_URL` is not set, so you need a running
  Postgres (and, for the worker, Redis) to execute them:

  ```bash
  npm run test --workspace @eonrover/api
  npm run test --workspace @eonrover/worker
  ```

Run everything (build, then all workspace tests) from the repo root with:

```bash
npm run build
npm run test
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

## Deployment

The same images used for local development are production-ready:

```bash
docker compose -f docker-compose.yml up --build -d
```

For a real deployment, set strong, unique secrets for `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, point
`SMTP_*` at a real outbound mail provider instead of Mailpit, set `COOKIE_SECURE=true` and
`NODE_ENV=production`, and put a TLS-terminating reverse proxy in front of the `web` (port `3000`)
and `api` (port `4000`) services. Database migrations run automatically on API container start
(`npx prisma migrate deploy`), so rolling out a new schema is just a matter of deploying the new
API image.

## Environment variables

See [`.env.example`](./.env.example) for the full list of configuration values used across the
stack (database, Redis, mail, admin seed account, universe/game settings, etc.). None of the
example values are real secrets — replace them for any shared or production environment.
 
