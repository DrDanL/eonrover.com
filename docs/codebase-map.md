# Eon Rover codebase map

## Scope and inspection record

This document describes the repository at commit `abfe6ff` on 2026-09-04. It is based on a complete inspection of the tracked repository, including every source page, route, processor, test, migration, manifest, Dockerfile, and configuration file.

- No `AGENTS.md` exists in this repository.
- The worktree was clean before this documentation was added (`main...origin/main`).
- No database was reset, seeded, or otherwise changed during the inspection.
- `node_modules` is absent, so TypeScript builds, linting, the Next.js build, and dependency-backed Jest suites were not run. Dependencies were not installed.
- The already-compiled shared formula suite was safe to run and passed all 9 tests: `node --test packages/shared/dist/formulas.test.js`.
- `docker compose config --quiet` accepted `docker-compose.yml`. Inspecting live container state was not possible because this environment could not access the Docker socket; no containers were started.
- The API and worker Jest suites were deliberately not run. Both `apps/api/src/testSetup.ts:5` and `apps/worker/src/testSetup.ts:5` delete all application rows before each test whenever any `DATABASE_URL` is set, without proving that the target is an isolated test database.

Runtime behavior that depends on a live PostgreSQL, Redis, SMTP service, browser, or full container restart therefore remains unverified unless a source-level conclusion is stated below.

## Current application in one paragraph

Eon Rover is a compact TypeScript npm-workspaces monorepo containing a Next.js browser client, an Express REST API, a PostgreSQL schema accessed through Prisma, a Redis/BullMQ timed-job layer, and a separate BullMQ worker. It has real connected flows for account registration, email verification, database-backed sessions, automatic homeworld creation, lazy timestamp-based production, construction/research/shipyard queues, fleet missions, several mission outcomes, social features, public statistics, and an administrator interface. It is a broad prototype rather than a production-ready game: important competitive state is nominally calculated on the server, but atomicity, job idempotency, queue recovery, game-rule enforcement, test isolation, and deployment security are not yet strong enough for a trustworthy persistent multiplayer universe.

## Area-by-area assessment

The classifications below use the requested vocabulary. “Implemented and connected” means there is a frontend-to-API-to-persistence path, not that the area is production-ready.

| Intended area | Classification | Evidence and qualification |
| --- | --- | --- |
| Public website | Partially implemented | Landing, features, guide, news, stats, leaderboard, auth, contact, privacy, and terms routes exist under `apps/web/src/app`. News, stats, and leaderboard use real API data; marketing/legal/contact copy is static and should not be treated as final policy or support infrastructure. |
| User registration and login | Implemented and connected | `register`, `login`, `me`, and `logout` are wired through `apps/web/src/app/(public)` and `apps/api/src/routes/auth.ts`; accounts and sessions persist in PostgreSQL. Provisioning is not atomic and input normalization is incomplete. |
| Email verification and password reset | Partially implemented | Tokens, pages, SMTP delivery, expiry, one-time use, and session revocation on reset exist. Mail failures are swallowed, there is no resend flow, and production SMTP authentication/TLS is not configurable. |
| Player account and security management | Partially implemented | The settings page shows account data, supports logout, and links to reset-password. There is no session list/revocation, in-session password change, email change, account deletion, MFA, or recovery-code flow. |
| Planet management | Partially implemented | Registration creates a homeworld; owned planets can be listed, viewed, renamed, and created by colonisation. There is no abandon/transfer flow, field/slot capacity, or robust colonisation limit enforcement. |
| Resource production and storage | Partially implemented | `syncPlanetResources` computes elapsed-time production on the API and applies storage caps. Concurrent spend and building-transition accounting are unsafe, and advertised research bonuses are not applied. |
| Buildings and construction queues | Partially implemented | Catalog, cost, prerequisites, deduction, queue, cancellation, BullMQ completion, and UI countdowns exist. Mixed queues compute incorrect target levels, cancellation races with completion, and missing Redis jobs are not recovered. |
| Energy production and consumption | Partially implemented | Server-side supply, consumption, and efficiency affect lazy production and appear on the planet page. There is no allocation control, history, or transition-safe accounting. |
| Research and technology progression | Partially implemented | Account-wide levels, requirements, costs, one active queue, timed completion, and a UI exist. Several stated technology effects are disconnected and completion is not recoverable/idempotent enough. |
| Shipyard and fleet construction | Partially implemented | Ships and defences can be queued and completed one unit at a time. Multiple batches run in parallel, retry windows can duplicate units, and there is no cancellation or reconciliation. |
| Galaxy and solar-system navigation | Partially implemented | A protected galaxy browser renders 12 slots from live data. Query/mission coordinates have no configured upper bounds, and the screen does not launch context-aware missions. |
| Fleet missions and travel | Partially implemented | Dispatch, fuel, cargo, travel duration, recall, arrival, return, and gate travel are connected. Mission-specific rules, concurrency, recall races, idempotency, and recovery are incomplete. |
| Exploration | Partially implemented | `EXPLORE` is dispatched and has a server-side 20% Gate Fragment outcome. It lacks ship/target constraints, meaningful non-fragment outcomes, reports, and balancing controls. |
| Colonisation | Partially implemented | A colony ship can found a persisted random planet in an empty coordinate. Maximum planets is ignored, cargo is lost, multi-colony-ship handling is incorrect, and concurrency relies only on the database uniqueness error path. |
| Espionage | Partially implemented | Server-side reports and technology-based accuracy exist. Any ship can run the mission, reports always contain the full dataset regardless of accuracy, target resources can be stale, and detection is unconditional. |
| Combat | Partially implemented | Server-side combat, technology multipliers, reports, losses, loot, debris, notifications, and return travel exist. New-player protection and basic target rules are not enforced, retry safety is inadequate, and the formula is only lightly tested. |
| Debris and recycling | Partially implemented | Battles can create debris and `RECYCLE` can collect it. Heliox debris is always zero, recycler ships are not required, and concurrent recyclers can overdraw the field. |
| Alliances | Partially implemented | Create, open join, leave, list, membership, and roster UI are connected. There are no applications/invitations, permissions, rank changes, ownership transfer, or handling for a leader who leaves. |
| Messaging and notifications | Partially implemented | Compose/inbox/sent/read and notification list/read-all are connected. There is no player deletion/report/blocking flow, pagination, per-user anti-spam control, or complete event coverage. |
| Leaderboards | Implemented and connected | Public and protected boards compute a live score from planet count and building levels. The scoring model is minimal and recalculates by loading all active users and their planets/buildings. |
| New-player protection | Placeholder | `protectedUntil` is set and displayed in the galaxy browser, but `POST /api/fleet` does not stop attacks or raids against protected players. The admin-configured duration is also ignored during registration. |
| Administration and moderation | Partially implemented | Role-gated dashboards, user search, status/rename actions, announcements, job inspection/removal, security events, audit log, and health exist. Several API-only moderation endpoints have no UI, roles cannot be managed, and job removal strands database queue records. |
| Game configuration and balancing | Partially implemented | Six values are editable and stored. Economy, research, and fleet speeds are used; `universeSpeed` and `maxPlanetsPerPlayer` are unused, and registration uses the default rather than configured protection hours. |
| Administrative audit records | Partially implemented | Selected admin mutations call `logAudit`. Coverage is incomplete, failed deletes can still be logged as successful, and there is no tamper-evident or retention design. |
| Background jobs and timed events | Partially implemented | Four BullMQ queues and workers handle build, research, shipyard, and fleet timers. PostgreSQL and Redis both hold parts of workflow state, but there is no outbox, startup reconciliation, idempotency claim, or stale-job repair. |
| Graphics and visual assets | Placeholder | Visuals consist of CSS, a client-generated CSS starfield, the satellite emoji in navigation, and `favicon.ico`. No planet, ship, building, map, audio, or other production art inventory exists. |
| Automated testing | Partially implemented | 9 shared unit tests, 15 API integration tests, and 4 worker integration tests exist. Major systems and the web UI are untested; integration setup can erase any database named by `DATABASE_URL`. |
| Security, validation and rate limiting | Partially implemented | bcrypt, opaque DB sessions, HttpOnly/SameSite cookies, Helmet, CORS, Zod on most writes, a custom CSRF header, and global/auth rate limits exist. Atomic state enforcement, error handling, proxy/IP configuration, token storage, Redis/Postgres exposure, and abuse controls need work. |
| Accessibility and responsive behaviour | Partially implemented | Semantic headings/labels, focus-visible styles, `lang="en"`, flexible grids, a stacked mobile shell, and reduced-motion handling exist. There are no audits/tests, no live-region announcements, no mobile table overflow treatment, and no verified contrast/keyboard/screen-reader pass. |
| Deployment and operational documentation | Partially implemented | Dockerfiles, Compose, `.env.example`, health endpoints, migration-on-start, backup notes, and local-development instructions exist. The production claim is too strong; several env overrides do not work in Compose, exposed services use weak/no credentials, and there is no CI/CD, TLS proxy, monitoring, restore test, or rollback/runbook. |

## Repository map

There are 136 tracked files at this snapshot. Generated build output is tracked only for `packages/shared/dist`; other build products and dependency directories are absent.

```text
.
├── .dockerignore                 Docker build-context exclusions
├── .env.example                  documented local/default environment values
├── .gitignore                    repository-wide generated/secret exclusions
├── README.md                     overview, run, test, backup, and deployment claims
├── docker-compose.yml            PostgreSQL, Redis, Mailpit, API, worker, web
├── package.json                  npm workspace root and aggregate scripts
├── package-lock.json             lockfile v3 for all workspaces
├── apps
│   ├── api
│   │   ├── Dockerfile
│   │   ├── jest.config.js
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── prisma
│   │   │   ├── schema.prisma
│   │   │   ├── seed.ts
│   │   │   └── migrations
│   │   │       ├── 20260903205604_init/migration.sql
│   │   │       ├── 20260904063856_add_gate_travel_mission/migration.sql
│   │   │       └── migration_lock.toml
│   │   └── src
│   │       ├── app.ts            middleware and router composition
│   │       ├── server.ts         HTTP listener
│   │       ├── lib               auth, mail, Prisma, Redis/BullMQ clients
│   │       ├── middleware        session/RBAC/CSRF checks
│   │       ├── routes            auth, game, social, public, and admin REST routes
│   │       ├── services          universe config, requirements, planet production
│   │       ├── *.test.ts         route integration tests
│   │       └── testSetup.ts      destructive table cleanup for DB-backed tests
│   ├── worker
│   │   ├── Dockerfile
│   │   ├── jest.config.js
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src
│   │       ├── index.ts          four workers plus a basic HTTP health endpoint
│   │       ├── prisma.ts, redis.ts, queues.ts
│   │       ├── processors        build, research, shipyard, and fleet resolution
│   │       ├── processors/fleetProcessor.test.ts
│   │       └── testSetup.ts      same destructive cleanup pattern as API tests
│   └── web
│       ├── .gitignore
│       ├── Dockerfile
│       ├── eslint.config.mjs
│       ├── next.config.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── src
│           ├── app
│           │   ├── (public)      marketing, legal, auth, news/stats/leaderboard
│           │   ├── (game)/game   protected player pages
│           │   ├── (admin)/admin role-gated administrator pages
│           │   ├── page.tsx      root landing page (outside the public route group)
│           │   ├── layout.tsx, globals.css
│           │   └── favicon.ico
│           ├── components        navigation, starfield, resources, status UI
│           └── lib               fetch/auth hooks, formatters, duplicated web types
├── packages
│   └── shared
│       ├── package.json, tsconfig.json
│       ├── src                   constants, types, pure formulas, unit tests
│       └── dist                  tracked generated JS and declarations
└── docs
    ├── codebase-map.md
    └── implementation-roadmap.md
```

## Technical stack and tools

The root requires Node.js 20 or newer and uses npm workspaces (`package.json`). The lockfile currently resolves notable packages as follows:

| Layer | Technology |
| --- | --- |
| Browser | Next.js 16.3.4 App Router, React/React DOM 19.2.8, TypeScript 5.9.3, handwritten global CSS |
| API | Express 4.22.2, TypeScript/CommonJS, Zod 3.25.76, Helmet 7, CORS, cookie-parser, express-rate-limit |
| Authentication/mail | bcryptjs 2.4.3, opaque PostgreSQL session IDs, UUID, Nodemailer 9.0.1 |
| Data | PostgreSQL 16 Alpine, Prisma Client/CLI 5.22.0 |
| Timers/jobs | Redis 7 Alpine, BullMQ 5.81.4, ioredis 5.11.1 |
| Local mail | Mailpit `latest` image, SMTP on 1025 and web UI on 8025 |
| Tests | Node test runner for shared formulas; Jest 29, ts-jest, Supertest for API/worker integration |
| Containers | Three multi-stage Node 20 Bullseye images plus Compose-managed infrastructure |
| Lint/build | ESLint 9 for web; API/worker scripts reference ESLint but do not declare ESLint/config locally; `tsc` for shared/API/worker |

`jsonwebtoken` and `@types/jsonwebtoken` are declared in `apps/api/package.json` but are never imported. Authentication uses database sessions, not JWTs.

## Architecture and important dependencies

```text
Browser
  └─ Next.js client pages and AuthProvider
       └─ apiFetch (credentials + X-Eonrover-Client header)
            └─ Express API
                 ├─ auth/RBAC/validation
                 ├─ Prisma ────────────── PostgreSQL (authoritative persisted rows)
                 └─ BullMQ Queue ──────── Redis (delayed wake-ups and job payloads)
                                              └─ Worker processors
                                                   └─ Prisma ── PostgreSQL
```

- There are no Next.js route handlers, server actions, middleware guards, WebSockets, or server-rendered API calls. Dynamic pages use browser-side fetches through `apps/web/src/lib/api.ts:17`.
- `AuthProvider` calls `GET /api/auth/me` after hydration (`apps/web/src/lib/AuthContext.tsx:29`). Player/admin layouts are client-side display guards; API middleware is the actual authorization boundary.
- The shared package is used by API and worker for constants and formulas. The web app duplicates transport-facing types in `apps/web/src/lib/web-types.ts` and does not import shared game types.
- PostgreSQL stores game state and queue records. Redis stores the delayed BullMQ jobs that cause workers to advance those records. Neither side reconciles the other.
- Resource production is not a recurring job. It is calculated lazily on owned-planet reads or immediately before selected spends by `syncPlanetResources` (`apps/api/src/services/planetService.ts:45`).

## Frontend routes

### Public routes

| Route | Source | State |
| --- | --- | --- |
| `/` | `apps/web/src/app/page.tsx` | Static landing page; outside `(public)` layout and therefore imports its own public nav/footer. |
| `/features` | `apps/web/src/app/(public)/features/page.tsx` | Static marketing copy; some claims exceed implemented rules. |
| `/guide` | `apps/web/src/app/(public)/guide/page.tsx` | Static guide; describes research effects not wired into production/flight. |
| `/news` | `apps/web/src/app/(public)/news/page.tsx` | Connected to `GET /api/public/announcements`. |
| `/stats` | `apps/web/src/app/(public)/stats/page.tsx` | Connected to `GET /api/public/stats`. |
| `/leaderboard` | `apps/web/src/app/(public)/leaderboard/page.tsx` | Connected to the top-10 preview. |
| `/register` | `apps/web/src/app/(public)/register/page.tsx` | Connected registration form. |
| `/login` | `apps/web/src/app/(public)/login/page.tsx` | Connected login form and auth-context refresh. |
| `/verify-email?token=...` | `apps/web/src/app/(public)/verify-email/page.tsx` | Client effect posts token to API. |
| `/forgot-password` | `apps/web/src/app/(public)/forgot-password/page.tsx` | Connected request form. |
| `/reset-password?token=...` | `apps/web/src/app/(public)/reset-password/page.tsx` | Connected password update form. |
| `/contact` | `apps/web/src/app/(public)/contact/page.tsx` | Static `mailto:support@eonrover.com`; no ticket integration. |
| `/privacy` | `apps/web/src/app/(public)/privacy/page.tsx` | Short static draft, not verified legal policy. |
| `/terms` | `apps/web/src/app/(public)/terms/page.tsx` | Short static draft, not verified legal terms. |

### Player routes

All are beneath the client-guarded layout in `apps/web/src/app/(game)/game/layout.tsx:9`.

| Route | Purpose and connection |
| --- | --- |
| `/game` | Live planet list and aggregate stored resources. |
| `/game/planets/[planetId]` | Full owned-planet state, energy, queues, garrison, and rename. |
| `/game/planets/[planetId]/buildings` | Catalog, enqueue, countdown, cancel. |
| `/game/planets/[planetId]/research` | Account research catalog and enqueue funded from route planet. |
| `/game/planets/[planetId]/shipyard` | Ship/defence catalog and batch enqueue. |
| `/game/planets/[planetId]/fleet` | Generic form for every mission, all account missions, and recall. |
| `/game/galaxy` | Live 12-slot system browser. |
| `/game/gates` | Fragments, gate activation, gate linking. |
| `/game/alliances` | Directory, membership, create, join, leave. |
| `/game/messages` | Compose, inbox, sent, mark read. |
| `/game/notifications` | List, mark one/all read. |
| `/game/leaderboard` | Protected top-100 board. |
| `/game/reports` | Combat and espionage records rendered mainly as raw JSON. |
| `/game/settings` | Account summary, logout, reset-password link; explicitly notes unavailable session management. |

### Administrator routes

All are beneath `apps/web/src/app/(admin)/admin/layout.tsx:8`, which permits `MODERATOR` and `ADMIN`; individual API routes impose stricter admin-only checks where present.

| Route | Purpose and connection |
| --- | --- |
| `/admin` | Live counts, four queue summaries, PostgreSQL/Redis checks. |
| `/admin/users` | Search/list; admins can rename and set ACTIVE/SUSPENDED/BANNED. |
| `/admin/announcements` | List, create, delete. Both moderators and admins can mutate. |
| `/admin/config` | View all values; admin-only edits. |
| `/admin/jobs` | View delayed/failed jobs; admin-only removal. |
| `/admin/security` | Last 100 security events. |
| `/admin/audit` | Last 200 selected admin actions. |

There is no UI for the existing admin user-detail, message-delete, or alliance-delete endpoints.

## REST API inventory

All mutating requests pass the global custom-header check in `requireCsrfHeader` (`apps/api/src/middleware/auth.ts:60`). “Connected” means called by a current page or Docker healthcheck.

| Method and path | Auth | Implementation status |
| --- | --- | --- |
| `GET /healthz` | Public | Connected to API Docker healthcheck; checks PostgreSQL only. |
| `POST /api/auth/register` | Public + auth limiter | Connected; creates pending user, homeworld, buildings, verification token, then attempts mail. Multi-step process is not transactional. |
| `POST /api/auth/verify-email` | Public + auth limiter | Connected; atomically activates user and consumes token. |
| `POST /api/auth/login` | Public + auth limiter | Connected; verifies bcrypt hash, account status, creates DB session/cookie, logs failed credential attempts. |
| `POST /api/auth/logout` | Player | Connected; deletes current session and clears cookie. |
| `GET /api/auth/me` | Player | Connected; returns middleware user projection. |
| `POST /api/auth/forgot-password` | Public + auth limiter | Connected; enumeration-resistant response, but mail failures are hidden. |
| `POST /api/auth/reset-password` | Public + auth limiter | Connected; changes hash, consumes token, and revokes all sessions transactionally. |
| `GET /api/planets` | Player | Connected; syncs and lists every owned planet. |
| `GET /api/planets/:id` | Owning player | Connected; syncs resources and returns buildings, units, queues, energy, storage. |
| `PATCH /api/planets/:id` | Owning player | Connected; trims and limits name to 40 characters. |
| `GET /api/planets/:planetId/buildings` | Owning player | Connected; catalog, levels, next cost, pending queue. |
| `POST /api/planets/:planetId/buildings` | Owning player | Connected; checks catalog/requirements/resources, deducts, records, schedules. Contains mixed-queue and race defects. |
| `DELETE /api/planets/:planetId/buildings/:queueItemId` | Owning player | Connected; marks cancelled, refunds 50%, tries to remove Redis job. Races with worker and does not reschedule later work. |
| `GET /api/research` | Player | Connected; account-wide catalog and pending job. |
| `POST /api/research` | Player owning funding planet | Connected; checks one active research, requirements/resources, deducts, records, schedules. |
| `GET /api/planets/:planetId/shipyard` | Owning player | Connected; catalog, counts, pending batches. |
| `POST /api/planets/:planetId/shipyard` | Owning player | Connected; requirements/resources, batch record, first-unit job. Multiple batches are unintentionally parallel. |
| `GET /api/fleet` | Player | Connected; last 50 missions whose origin belongs to player, including completed missions. |
| `POST /api/fleet` | Owning origin player | Connected; validates generic shape/ownership/counts, calculates server duration/fuel, deducts, records, schedules. Mission-specific policy is incomplete. |
| `POST /api/fleet/:id/recall` | Origin owner | Connected; removes arrival job if possible and schedules return. Has an arrival race. |
| `GET /api/gates` | Player | Connected; owned fragments and gates. |
| `POST /api/gates/activate` | Owning player | Connected; prerequisites, consumes first three account fragments, creates visible gate. |
| `POST /api/gates/link` | Owner of both planets | Connected; symmetrically links two gates and clears prior partners. |
| `GET /api/galaxy/:galaxy/:system` | Player | Connected; positive integers only, no maximum bounds. |
| `GET /api/messages` | Player | Connected; top 100 inbox and sent. |
| `POST /api/messages` | Player | Connected; sends to exact username and creates notification. |
| `POST /api/messages/:id/read` | Recipient | Connected. |
| `GET /api/alliances` | Player | Connected; returns all full rosters without pagination. |
| `GET /api/alliances/mine` | Player | Connected. |
| `POST /api/alliances` | Player without membership | Connected; creates alliance and leader membership. |
| `POST /api/alliances/:id/join` | Player without membership | Connected; open join. |
| `POST /api/alliances/leave` | Player | Connected; can leave an alliance leaderless. |
| `GET /api/leaderboard` | Player | Connected; dynamically computes top 100. |
| `GET /api/notifications` | Player | Connected; top 100. |
| `POST /api/notifications/:id/read` | Notification owner | Connected. |
| `POST /api/notifications/read-all` | Player | Connected. |
| `GET /api/reports/combat` | Participant | Connected; top 50. |
| `GET /api/reports/espionage` | Report owner | Connected; top 50. |
| `GET /api/public/stats` | Public | Connected. |
| `GET /api/public/leaderboard-preview` | Public | Connected; top 10. |
| `GET /api/public/announcements` | Public | Connected; latest 20. |
| `GET /api/admin/dashboard` | Moderator/admin | Connected; DB counts and queue counts. |
| `GET /api/admin/users` | Moderator/admin | Connected; search and latest 50. |
| `GET /api/admin/users/:id` | Moderator/admin | Implemented API only; not called by web. Returns planet/unit detail after removing `passwordHash`. |
| `POST /api/admin/users/:id/status` | Admin | Connected; status and session revocation for non-active states. |
| `POST /api/admin/users/:id/rename` | Admin | Connected. |
| `GET /api/admin/config` | Moderator/admin | Connected. |
| `POST /api/admin/config` | Admin | Connected; positive numbers only. |
| `GET /api/admin/announcements` | Moderator/admin | Connected. |
| `POST /api/admin/announcements` | Moderator/admin | Connected. |
| `DELETE /api/admin/announcements/:id` | Moderator/admin | Connected; logs deletion even when target did not exist. |
| `DELETE /api/admin/messages/:id` | Moderator/admin | Implemented API only; not called by web. |
| `DELETE /api/admin/alliances/:id` | Admin | Implemented API only; not called by web. |
| `GET /api/admin/jobs` | Moderator/admin | Connected; first 20 failed/delayed per queue, including job payloads. |
| `DELETE /api/admin/jobs/:queue/:id` | Admin | Connected; removes BullMQ job only and strands the corresponding PostgreSQL state. |
| `GET /api/admin/security-events` | Moderator/admin | Connected. |
| `GET /api/admin/audit-log` | Moderator/admin | Connected. |
| `GET /api/admin/health` | Moderator/admin | Connected; independently probes PostgreSQL and Redis. |

There is a JSON 404 fallback but no centralized error middleware (`apps/api/src/app.ts:71`). Because route handlers are async under Express 4, unexpected Prisma, Redis, parsing, or mail-adjacent errors do not have a consistent safe JSON response path.

## Database models and relationships

`apps/api/prisma/schema.prisma` defines PostgreSQL as the only durable game database. The initial migration creates all models; the second adds `GATE_TRAVEL` to `MissionType`.

| Model | Purpose and relationships |
| --- | --- |
| `User` | Unique email/username, bcrypt hash, role/status, verification/protection/activity timestamps. One-to-many planets, sessions, verification tokens, sent/received messages, notifications, audit logs, security events, and fragments; optional alliance membership. |
| `Session` | Opaque cookie ID, user FK with cascade, 14-day expiry, IP/user-agent. No rotation, cleanup, listing, or individual revocation UI. |
| `VerificationToken` | Unique plaintext token for email verification or password reset; user FK with cascade, expiry/use timestamps. |
| `Planet` | Owner FK, unique galaxy/system/slot, environment, floating-point resources and production timestamp. Owns buildings/queues/units/missions/debris/fragments/gate. |
| `Building` | Unique `(planetId,key)` and level; planet FK/cascade. Keys are strings rather than database enums/FKs to definitions. |
| `BuildQueueItem` | Planet, string building key, target level, timestamps/status, optional Redis job ID. |
| `Research` | Unique `(userId,key)` and level. `userId` is only a string: there is no Prisma relation or database FK to `User`, so orphan research is possible. |
| `ResearchQueueItem` | Planet, research key/target/timer/status/job. User ownership is inferred through planet; completion user comes from Redis payload. |
| `Ship`, `Defence` | Unique `(planetId,key)` count records with planet cascade. Keys are unbounded strings at the database layer. |
| `ShipyardQueueItem` | Planet, item key/type, quantity/remaining, current unit timer/status/job. `itemType` is an unbounded string in the database. |
| `FleetMission` | Origin FK/cascade, optional target FK/set-null, target coordinates, enum mission/status, JSON ships/cargo/results, timers/job. Ownership is inferred from origin. |
| `CombatReport`, `EspionageReport` | JSON reports with string IDs for mission/users/planet. None of those IDs has a database FK, so reports can become orphaned. |
| `DebrisField` | One optional field per planet with alloy/heliox amounts and cascade. |
| `GateFragment` | Owner and planet FKs. The schema does not constrain the fragment planet to have the same owner. |
| `EonGate` | One gate per planet, optional unique linked gate ID, visibility. `linkedGateId` is not a self-relation/FK, so dangling/asymmetric links are possible outside the route transaction. |
| `Alliance`, `AllianceMember` | Unique name/tag; one membership per user with alliance/user cascades and rank enum. |
| `Message` | Sender/recipient FKs with cascade, subject/body/read timestamp. |
| `Notification` | User FK/cascade, free-form type/message/read timestamp. |
| `Announcement` | Title/body and string `authorId`; no author FK. |
| `UniverseSetting` | Unique key plus JSON value. Route writes use the key for both `id` and `key`; the schema default ID `singleton` is misleading but not used by that route. |
| `AuditLog` | Actor user FK/cascade plus free-form action/target/metadata. Deleting the actor deletes their audit history. |
| `SecurityEvent` | Optional user FK/set-null, free-form type/IP/metadata. Failed login records store the attempted email in JSON. |

Notable modeling choices to resolve before scale: floating-point resources, free-form definition keys, missing report/research/gate/announcement relations, audit deletion on actor deletion, no optimistic version/ledger, and no durable event/outbox record.

## Authentication and authorization flow

1. The register page posts email, username, and password. `registerSchema` validates shape (`apps/api/src/routes/auth.ts:14`). The API checks exact-case uniqueness, hashes with bcrypt cost 12, creates a pending user, immediately creates a homeworld, then creates and emails a verification token.
2. The verification page posts the URL token. The API transaction marks the user `ACTIVE` and the token used.
3. Login uses exact email lookup and bcrypt comparison. Banned/suspended/pending users are rejected. `createSession` inserts an opaque UUID session and sets `eonrover_sid` HttpOnly, SameSite=Lax, path `/`, 14-day cookie (`apps/api/src/lib/auth.ts:21`). Secure is enabled only when production and `COOKIE_SECURE` is not `false`.
4. `requireAuth` reads the cookie, joins the session/user, checks expiry and banned/suspended state, and attaches a reduced user. It asynchronously updates `lastActiveAt` without awaiting failure (`apps/api/src/middleware/auth.ts:21`).
5. `requireRole` protects admin endpoints. Web layouts improve navigation but do not form the security boundary.
6. Password reset consumes a one-hour token, changes the hash, and deletes all sessions in one transaction.

Security positives: passwords never leave the auth handler after hashing/verification; password hashes are removed from admin detail; cookies are HttpOnly; writes require a non-simple custom header; CORS allows one configured web origin; public password-reset response is enumeration-resistant.

Gaps: no atomic registration transaction, no resend/verified mail delivery state, plaintext bearer tokens at rest, no password breach/strength rules beyond length, case-sensitive/un-normalized identities, no session rotation/cleanup/management, no proxy trust plan, and no error boundary around async handlers.

## Existing game systems and formulas

Definitions live in `packages/shared/src/constants.ts`; pure calculations live in `packages/shared/src/formulas.ts`.

### Economy and time

- Starting resources: 500 Alloy, 300 Heliox, 0 Aether (`STARTING_RESOURCES`, `constants.ts:419`). Registration also creates Alloy Mine 0, Heliox Extractor 0, and Solar Array 1 (`auth.ts:49`, `auth.ts:92`).
- Building/research costs: each component is `round(baseCost * growth^(targetLevel-1))` (`scaledCost`, `formulas.ts:15`).
- Building time: `max(round(((alloy + heliox) / (2500 * (1 + researchLabLevel)) / economySpeed) * 3600), 15)` seconds (`buildingDurationSeconds`, `formulas.ts:40`). A research lab, rather than a dedicated construction building, accelerates construction.
- Research time: `max(round(((alloy + heliox + 2*aether) / (1000 * (1 + labLevel)) / researchSpeed) * 3600), 30)` seconds (`researchDurationSeconds`, `formulas.ts:53`).
- Shipyard time per unit: `max(round(baseSeconds / max(1, log2(shipyardLevel+2)) / economySpeed), 10)` (`shipyardDurationSeconds`, `formulas.ts:63`).
- Hourly production: 30/20/3 base rate for Alloy/Heliox/Aether, multiplied by `level * 1.1^level * planetTypeMultiplier * economySpeed * researchBonus` (`hourlyProduction`, `formulas.ts:79`). The caller always uses the default research bonus 1, so economy research descriptions do not affect output.
- Storage: `round(10000 * 1.5^storageLevel)` (`storageCapacity`, `formulas.ts:105`). Lazy accumulation clamps only production gains to this cap.
- Energy: base supply 20. Solar output is `20 * level * 1.1^level * (0.5 + solarIndex)`; other configured building energy is linear by level. Production efficiency is `min(1, supply/consumption)` (`formulas.ts:94-121`).
- Planet type affects resource multipliers. Temperature is stored and displayed but is not used in any formula; solar index only affects solar energy.

### Travel, intelligence, and combat

- Distance is 20,000 per galaxy difference; otherwise `2700 + 95*systemDifference`; otherwise `1000 + 5*slotDifference`; same coordinate is 5 (`distanceBetween`, `formulas.ts:145`).
- Flight duration is `max(round(3500 * sqrt(10*distance/effectiveSpeed) + 10), 5)` with requested speed clamped to 10–100% and configured fleet speed (`flightDurationSeconds`, `formulas.ts:167`). `propulsionTheory` is not included.
- One-way fuel sums `fuelPerDistance * distance * count * (1 + duration/36000)` and rounds (`fuelConsumption`, `formulas.ts:179`). No fuel is charged for a return leg or gate travel.
- Espionage accuracy is `clamp(0.5 + 0.08*(attackerLevel-defenderLevel), 0.1, 1)` (`espionageAccuracy`, `formulas.ts:289`), but report fields are not filtered by accuracy.
- Combat lasts up to six rounds. Every unit fires once at a random opposing unit; `max(0, attack-shield)` permanently reduces hull. Shields do not deplete within a round or regenerate explicitly. Surviving partial hull carries between rounds (`resolveCombat`, `formulas.ts:223`).
- Weapon/shield/armour research gives 10% per level in the worker (`techBonus`, `apps/worker/src/processors/fleetProcessor.ts:21`).
- Destroyed armour adds 30% to an intermediate debris number, which is then multiplied by 50%; effective Alloy debris is 15% of destroyed armour. Heliox debris is declared but never incremented (`formulas.ts:230-280`).
- A victorious attacker takes up to 50% of target resources, sequentially filling surviving cargo with Alloy, then Heliox, then Aether (`fleetProcessor.ts:236-254`). Target production is not synchronized first.
- Exploration independently has a hard-coded 20% Gate Fragment chance (`fleetProcessor.ts:338`). Gate activation requires three fragments, Gate Observatory 1, and Gate Theory 1; gate travel is a fixed 15 seconds (`constants.ts:423-429`).
- Default universe settings are speed multipliers 1, protection 72 hours, and maximum 9 planets (`DEFAULT_UNIVERSE_CONFIG`, `constants.ts:410`). Only economy, research, and fleet speeds currently affect behavior.

## Server-authority assessment

The intended authority boundary is clear and mostly located correctly:

- The browser submits action choices, not resource balances, queue completion timestamps, loot, exploration rolls, combat outcomes, or final travel duration.
- The API loads owned rows, computes costs/fuel/durations, deducts state, and stores server timestamps.
- The worker uses server-side formulas and randomness to complete queues and missions.
- UI countdowns (`useTicker`) are display-only; they do not complete work.

The browser therefore cannot directly choose an arbitrary total or outcome through a documented endpoint. However, competitive state is not safely authoritative under concurrency or failure:

- Spend paths perform “read/check, then unconditional decrement” across separate transactions. Parallel build/research/shipyard/fleet requests can both pass the check and drive resources or ship counts negative (`buildings.ts:70-95`, `research.ts:68-85`, `shipyard.ts:85-110`, `fleet.ts:121-151`).
- Fleet ship counts are checked before a transaction and then decremented without a `count >= requested` predicate (`fleet.ts:63-69`, `fleet.ts:130-137`).
- Redis is published on host port 6379 with no authentication in Compose. Anyone who can reach it can manipulate trusted job payloads such as research `userId` and shipyard `perUnitSeconds`.
- Worker processors do not atomically claim a pending row before side effects. BullMQ retry/stall behavior can duplicate ships, cargo, loot, colonies, fragments, returns, reports, or notifications.
- Worker payloads carry values that should be derived from PostgreSQL/definitions: research `userId` and shipyard `perUnitSeconds` (`researchProcessor.ts:15`, `shipyardProcessor.ts:32`).
- New-player protection is cosmetic: the fleet route does not enforce `protectedUntil` for attack/raid.
- Mission-specific validation is incomplete: DEPLOY can transfer ships to someone else's planet, self-attacks are allowed, and ESPIONAGE/RECYCLE/EXPLORE do not require the intended vessel.

Server-calculated is therefore accurate; exploit-resistant and retry-safe is not yet accurate.

## Background jobs, queues, and timed-event handling

`apps/api/src/lib/redis.ts:12` creates four BullMQ queues:

| Queue | Created by | Worker effect |
| --- | --- | --- |
| `build-queue` | Building route | Upserts target building level, completes row, notifies. |
| `research-queue` | Research route | Upserts account research using job `userId`, completes row, notifies. |
| `shipyard-queue` | Shipyard route and processor | Adds one unit, decrements remaining, schedules the next unit, eventually notifies. |
| `fleet-queue` | Fleet route and processor | Resolves arrival/mission effect, schedules return, or restores ships/cargo at origin. |

Each API flow first commits PostgreSQL state, then enqueues Redis work, then writes the Redis job ID back to PostgreSQL. Failures between those steps create pending rows without usable jobs. There is no startup scan, periodic reconciliation, transactional outbox, unique deterministic job ID, or manual repair action.

Redis has a named volume and snapshot rule `--save 60 1`, so graceful persistence may retain delayed jobs, but the code provides no correctness guarantee after a crash, recent snapshot loss, Redis-volume loss, or a PostgreSQL/Redis split-brain. PostgreSQL queue timestamps could be the recovery source, but nothing currently uses them that way.

Processor-specific hazards:

- Build/research check `PENDING` before the transaction but do not conditionally claim it. Target-level upserts are mostly repeatable, but notifications and status races are not.
- Shipyard commits the unit increment before scheduling/updating the next unit. A failure in between causes a retry to add the same unit again.
- Fleet arrival applies effects before `scheduleReturn` changes status. Return jobs are processed by job name even if the mission is already `COMPLETE`; a retry can restore ships/cargo again (`fleetProcessor.ts:394-403`).
- Admin job deletion removes only Redis state (`admin.ts:170`), with no queue-record transition or refund.
- Worker `/healthz` reports 200 whenever its small HTTP server is alive; it does not test the worker's PostgreSQL or Redis connections (`apps/worker/src/index.ts:43`).

## Docker services, persistence, and local development

`docker-compose.yml` defines:

| Service | Ports | Persistence/start behavior |
| --- | --- | --- |
| `postgres` | `5432:5432` | `postgres_data`; PostgreSQL 16; health via `pg_isready`. |
| `redis` | `6379:6379` | `redis_data`; unauthenticated Redis 7 with periodic RDB snapshots. |
| `mailpit` | `8025:8025`, `1025:1025` | `mailpit_data`; image is unpinned `latest`. |
| `api` | `4000:4000` | Waits for infrastructure; container command runs `prisma migrate deploy`, then the optional admin seed, then Express. |
| `worker` | internal health 4100 | Waits for API and infrastructure; starts four workers. |
| `web` | `3000:3000` | Builds browser API URL into Next bundle and waits for API. |

Expected Docker run path from `README.md` is `cp .env.example .env` followed by `docker compose up --build`. Expected direct-development path is npm install, build shared, apply Prisma migrations, then run API, worker, and web in separate terminals with PostgreSQL, Redis, and Mailpit already available.

Game data persists in PostgreSQL. Redis contains operational queue state that is described as transient in the README but is currently required to finish persisted pending work. Mailpit persistence is local convenience only.

The README's backup commands are likely broken when values exist only in `.env`: host-shell expansion of `$POSTGRES_USER`/`$POSTGRES_DB` occurs before Compose applies `.env` to the service. Backups and restores are not tested or automated.

## Configuration and environment variables

No secret values were read. The documented names and behavior are:

| Variable | Consumer | Notes |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Compose | Used to configure PostgreSQL and assemble container `DATABASE_URL`; weak development fallbacks are supplied. |
| `DATABASE_URL` | Prisma API/worker and tests | Required outside Compose. Any value also activates destructive integration cleanup. Direct override is not passed through by Compose. |
| `REDIS_URL` | API/worker source | Defaults to local Redis in source. `.env.example` documents it, but Compose hard-codes `redis://redis:6379`, ignoring an override. |
| `PORT` | API | Defaults 4000. Compose port mapping and healthcheck remain fixed at 4000, so overriding it breaks the service contract. |
| `NODE_ENV` | API/container | Controls Prisma singleton and cookie default; Compose defaults production. |
| `WEB_URL` | API | Single CORS origin and base for email links. |
| `COOKIE_SECURE` | API | `false` supports local HTTP even with production node mode. Must be true behind production HTTPS. |
| `SMTP_HOST`, `SMTP_PORT` | API mailer | Source reads them, but Compose hard-codes Mailpit values, so README advice to point these elsewhere does not work without editing Compose. No username/password/TLS variables exist. |
| `MAIL_FROM` | API mailer | Sender address. |
| `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` | API startup seed | All must be present; creates one active admin if email is absent. No gameplay records are seeded. |
| `WORKER_HEALTH_PORT` | Worker | Source reads it, but Compose healthcheck remains fixed at 4100. |
| `NEXT_PUBLIC_API_URL` | Web build/browser | Build argument is what matters for the client bundle; changing only the running container environment does not rewrite built browser code. |

Universe settings (`universeSpeed`, `economySpeed`, `fleetSpeed`, `researchSpeed`, `newPlayerProtectionHours`, `maxPlanetsPerPlayer`) are database/admin configuration, not environment variables.

## Graphics and asset inventory

- `apps/web/src/app/favicon.ico`: the only binary image asset; contains 16px and 32px icon resources.
- `Starfield` (`apps/web/src/components/Starfield.tsx`) generates 60 random CSS stars after hydration.
- `apps/web/src/app/globals.css` supplies the full dark palette, panels, responsive grids/shell, focus styles, and twinkle animation.
- `PublicNav` uses a satellite emoji as the wordmark.
- No `public/` directory, SVG, raster artwork, fonts, audio, video, canvas/WebGL scene, sprite sheet, attribution/license file, or asset pipeline is present.

## Automated testing coverage

| Suite | Existing coverage | Important omissions |
| --- | --- | --- |
| Shared, 9 tests | Scaled/build cost, production accumulation/cap, distance ordering, travel speed, espionage bounds, two combat cases. | Building/research/shipyard durations, energy, storage scaling, planet multipliers, fuel, exact distance cases, combat losses/debris/tech edge cases. |
| API, 15 tests | Register/verify/login/me, pending rejection, CSRF header, homeworld, building enqueue/prereq/funds/cancel, fleet dispatch basics, gate activation/link/travel. | Logout/reset/mail failure, authorization isolation, concurrent spends, resource timing, worker completion, research, shipyard, galaxy, all social/public/admin routes, protection, mission policy, validation/error paths. |
| Worker, 4 tests | Transport arrival, overwhelming attack, colonisation, gate deposit. | Build/research/shipyard processors, return/retry idempotency, recall races, espionage/exploration/recycle/deploy/raid, collisions, protection, failure recovery. |
| Web | None. | Component, route, accessibility, responsive, browser auth/cookie/CORS, and end-to-end vertical-slice coverage. |

The root `npm test` first builds workspaces and then runs all workspace tests. API/worker tests skip when `DATABASE_URL` is absent, so a green run without a database can mean that 19 integration tests did not execute. Conversely, setting a normal development/production `DATABASE_URL` makes them destructive.

## Confirmed defects, inconsistencies, and security concerns

### Critical correctness and data-safety risks

1. **Integration tests can erase a non-test database.** `hasTestDatabase` checks only for the presence of `DATABASE_URL`, then `beforeEach` deletes every table (`apps/api/src/testSetup.ts:3-34`; worker equivalent). There is no database-name or explicit destructive-test guard.
2. **Competitive deductions are non-atomic.** All resource/ship availability checks precede unconditional decrements. Concurrent requests can overspend or make ship/resource counts negative.
3. **Worker effects are not idempotent.** Shipyard and fleet processors have crash/retry windows that can duplicate assets/resources or repeat destructive outcomes. BullMQ is explicitly configured for three attempts.
4. **Database queue rows and Redis jobs can diverge.** No outbox/reconciler repairs a failure after the database commit but before/during job creation or job-ID update.
5. **Production across a building completion is calculated with the wrong level.** The build worker changes a production/energy/storage building without settling production at `completesAt`. The next sync applies the new final building state to the entire time since the previous sync (`planetService.ts:68-89`, `buildProcessor.ts:12-18`).
6. **New-player protection is not enforced.** The attack/raid dispatch path never checks target `protectedUntil`; the field is display-only.

### High-priority game defects

7. **Mixed construction queues calculate wrong levels.** `targetLevel = currentLevel + existingQueueCount + 1` counts all pending buildings, not pending items for the selected key (`buildings.ts:50-64`).
8. **Multiple shipyard batches run simultaneously.** Every POST schedules its first unit from now and there is no one-queue constraint or tail time (`shipyard.ts:91-117`).
9. **Shipyard retry can mint units.** The unit increment commits before `remaining` and the next job are updated (`shipyardProcessor.ts:14-41`).
10. **Fleet retries can duplicate mission effects and returns.** Transport/deploy/loot/recycle/colonisation effects occur before a durable claimed state; return processing does not reject `COMPLETE` missions.
11. **Recall can race arrival.** Removing a BullMQ job does not stop an already active processor, and neither side conditionally owns the mission transition.
12. **Configured protection and expansion limits are not applied.** Registration uses `DEFAULT_UNIVERSE_CONFIG` directly (`auth.ts:68`); colonisation never reads `maxPlanetsPerPlayer`. `universeSpeed` is also unused.
13. **Advertised research effects are disconnected.** Alloy Processing, Heliox Combustion, Aether Physics, and Propulsion Theory descriptions promise effects that production/travel callers never apply.
14. **Mission constraints are missing.** DEPLOY can target another owner; self-attacks are allowed; espionage/recycle/explore do not require Probe/Recycler/Scout; coordinates have no configured maximum.
15. **Colonisation mishandles ships and cargo.** Any positive colony-ship count removes the whole key on success, collision restores only one, cargo is neither deposited nor returned, and a new colony starts without the documented starting resource package (`fleetProcessor.ts:288-335`).
16. **Attack cargo is discarded.** `scheduleReturn` receives loot only rather than original cargo plus loot (`fleetProcessor.ts:236-265`).
17. **Espionage accuracy is cosmetic.** All resources/buildings/ships/defences are stored at every accuracy, and resources are read without lazy synchronization.
18. **Recycler correctness is incomplete.** Heliox debris is never generated, a recycler is not required, and concurrent missions can both read and decrement the same debris.
19. **Transport/deploy/gate deliveries bypass storage caps and target production synchronization.** Resource increments are unconditional.
20. **Alliance leaders can leave.** The alliance remains without a leader and no transfer/deletion policy runs.

### API/security/operations concerns

21. **No centralized async error handling.** Prisma uniqueness/not-found errors, Redis failures, malformed bodies, and unexpected exceptions have no normalized response/logging strategy in Express 4.
22. **Registration can leave partial records.** User, planet, and token are separate commits. Slot selection also has a check-then-create race; failure is not converted to a controlled retry.
23. **Mail delivery failure is silently accepted.** Register/reset respond as though delivery succeeded, and there is no verification resend route.
24. **Identity normalization is absent.** Email and username uniqueness/login are exact and case-sensitive; visually equivalent accounts and surprising login failures are possible.
25. **Redis/PostgreSQL are host-published with development security.** Redis has no password; PostgreSQL has a weak fallback. This directly conflicts with calling the same Compose file production-ready.
26. **Trusted worker fields are exposed through reachable Redis.** A Redis client could inject or alter queue payloads; worker research ownership and shipyard duration rely on payload data.
27. **Compose env documentation and behavior disagree.** `REDIS_URL`, `SMTP_HOST`, and `SMTP_PORT` are ignored; changing API/worker health ports breaks fixed healthchecks. Production SMTP cannot be configured as README directs.
28. **Rate limiting is process-local and proxy handling is undefined.** The app does not set `trust proxy`; deployments behind a reverse proxy can record/limit the proxy instead of the client or be configured unsafely later.
29. **Verification/reset tokens are plaintext database bearer secrets.** Database read access permits immediate token use until expiry.
30. **Expired sessions/tokens are never cleaned up.** No maintenance job exists.
31. **Worker health is superficial; API health omits Redis.** Compose can consider the worker healthy while it cannot process jobs, and API can be healthy while queue-backed actions fail.
32. **Admin job removal corrupts workflow semantics.** It does not cancel/refund/transition the database record. Audit delete methods can record success when the target did not exist.
33. **Audit retention is not durable.** `AuditLog.actor` cascades on user deletion, erasing the administrative record.
34. **README backup commands rely on host-shell variables that `.env` does not export.** Restore is undocumented beyond one command and untested.

### UI, type, and documentation inconsistencies

35. **The README and marketing overstate completeness/production readiness.** Broad features have real code but lack the safety and rules described above.
36. **No automatic live refresh occurs at timer completion.** Countdown text reaches zero, but pages do not poll/reload, so completion appears only after navigation/manual action reload.
37. **Production output is not exposed.** `ResourceBar` accepts `production`, but no current page passes it; the planet page explicitly notes the API omission (`PlanetOverviewPage`, line 133).
38. **Web types duplicate backend/shared contracts.** They can drift; `AdminUser.status` omits `PENDING_VERIFICATION` although the admin list can return it.
39. **Reports expose raw JSON instead of a complete readable battle/intelligence view.** Fleet `resultSummary` is never written.
40. **Tracked `packages/shared/dist` duplicates generated source output despite `dist/` being ignored.** A source-only change can leave stale executable tests/container package content.
41. **Unused/disconnected code exists.** JWT dependencies are unused; `invalidateUniverseConfigCache`, `UniverseConfig.universeSpeed`, `FleetMission.resultSummary`, gate `isVisible` beyond creation/return, `BuildingDefinition.producesResource`, and `ResourceBar.production` have no meaningful consumer. `apps/worker/src/queues.ts` constructs all four queue objects although processors only use shipyard/fleet queues.
42. **Responsive behavior is incomplete.** Layout grids stack, but tables have no overflow container and the large sidebar navigation becomes a long top block on narrow screens.
43. **API/worker linting is not self-contained.** Both workspaces define `eslint src --ext .ts`, but neither has an ESLint dependency or configuration; the only ESLint/config is declared for the web workspace. This is expected to fail or lint with unintended configuration and could not be verified without dependencies installed.

## Working functionality versus appearances

### What is genuinely connected

- Database-backed registration, verification, login, session lookup, logout, and reset-token processing.
- Automatic persisted homeworld creation with resources/building rows.
- Server-side lazy resource calculations, energy efficiency, storage calculation, building costs/times.
- Queue creation and worker code for construction, research, shipyard, and fleet actions.
- Live planet, galaxy, social, leaderboard, report, gate, notification, public-stat/news, and admin pages backed by API calls.
- PostgreSQL data volume and Redis/Mailpit volumes in Compose.
- Role checks on administrator APIs, with stricter admin-only checks for selected mutations.

### What only appears complete or behaves as a prototype

- New-player protection is displayed but provides no protection.
- Several research descriptions promise bonuses that never affect gameplay.
- Queue countdowns appear authoritative but can become permanently disconnected from Redis and do not refresh completion automatically.
- Fleet mission names exist across the UI, API, and worker, but mission prerequisites/policies and retry safety are incomplete.
- Espionage “accuracy” does not change revealed information.
- `isVisible` suggests public gate visibility, but the galaxy response does not expose gates.
- “Persistent across restart” is credible for PostgreSQL rows but not guaranteed for completion behavior because Redis jobs are a second unreconciled source.
- “Production-ready images” and deployment guidance do not account for exposed infrastructure, weak defaults, SMTP limitations, operational recovery, or monitoring.
- Privacy, terms, support, and game-guide pages are static content, not connected operational/legal systems.

No hard-coded or synthetic players, planets, rankings, messages, audit records, or gameplay records were found. The only seed path creates one administrator from environment variables (`apps/api/prisma/seed.ts`). Test files create temporary records only when run against a configured database.
