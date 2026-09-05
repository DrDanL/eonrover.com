# Eon Rover codebase map

## Scope and inspection record

This document was refreshed for the trusted vertical-slice checkpoint on 2026-09-05 after a complete inspection of the accumulated Stage 0–4B changes. Areas outside that slice retain the original 2026-09-04 prototype assessment unless explicitly updated below.

- No `AGENTS.md` exists in this repository.
- Stage 0 destructive test guards require `TEST_DATABASE_URL`, `ALLOW_TEST_DATABASE_RESET=1`, and a test-named database before cleanup can run.
- Runtime configuration, liveness, readiness, and normalized API error boundaries are implemented for the API and worker.
- The checkpoint verification covers the full unit/integration suite, workspace build, Compose parsing, clean migration install, and an opt-in disposable six-service restart scenario.
- The disposable stack uses a generated `eonrover-e2e-*` project, random loopback ports, project-scoped volumes, fixed disposable database credentials, output redaction, and scoped cleanup.
- ESLint 9 configuration failures remain a known issue outside this checkpoint; lint configuration was not repaired as part of Stages 0–4B.

The trusted registration-to-admin-inspection slice is verified against live PostgreSQL, Redis, Mailpit, API, worker, and web containers. Broader prototype systems remain outside that end-to-end guarantee.

## Current application in one paragraph

Eon Rover is a compact TypeScript npm-workspaces monorepo containing a Next.js browser client, an Express REST API, a PostgreSQL schema accessed through Prisma, a Redis/BullMQ timed-job layer, and a separate BullMQ worker. Its trusted vertical slice now provides atomic account/homeworld provisioning, recoverable email verification, digest-backed database sessions, row-locked timestamp production, atomic single-item building start/cancellation, PostgreSQL-authoritative idempotent completion with Redis reconciliation, restart verification, and an audited read-only administrator player-state view. Research, shipyard, fleet, social, deployment, and other advanced systems remain a broad prototype rather than production-ready gameplay.

## Area-by-area assessment

The classifications below use the requested vocabulary. “Implemented and connected” means there is a frontend-to-API-to-persistence path, not that the area is production-ready.

| Intended area | Classification | Evidence and qualification |
| --- | --- | --- |
| Public website | Partially implemented | Landing, features, guide, news, stats, leaderboard, auth, contact, privacy, and terms routes exist under `apps/web/src/app`. News, stats, and leaderboard use real API data; marketing/legal/contact copy is static and should not be treated as final policy or support infrastructure. |
| User registration and login | Implemented and connected | Registration atomically creates one user, homeworld, starter buildings, and digest-backed verification token. Email is trimmed/lowercased, usernames are trimmed with documented case-sensitive uniqueness, login uses a generic credential failure path, and raw random session tokens are stored only as SHA-256 digests. |
| Email verification and password reset | Partially implemented | Email verification has hashed one-time tokens, expiry, atomic consumption, enumeration-safe throttled resend, explicit delivery results, and a recovery UI. Password reset remains the earlier prototype flow and production SMTP authentication/TLS is not configurable. |
| Player account and security management | Partially implemented | The settings page shows account data, supports logout, and links to reset-password. There is no session list/revocation, in-session password change, email change, account deletion, MFA, or recovery-code flow. |
| Planet management | Partially implemented | Registration atomically creates exactly one homeworld with a bounded coordinate-collision retry and the configured protection duration; owned planets can be listed, viewed, renamed, and created by colonisation. There is no abandon/transfer flow, field capacity, or robust colonisation-limit enforcement. |
| Resource production and storage | Implemented for the trusted slice | `syncPlanetResources` advances elapsed server-time production under a per-planet PostgreSQL row lock, persists fractional balances/timestamps, applies energy and production storage caps, and prevents duplicate accrual under concurrent reads/spends. Research bonuses and non-production delivery/loot storage policy remain outside the slice. |
| Buildings and construction queues | Implemented for the trusted slice | One active building item per planet is enforced. Start and cancellation settle production and atomically write costs/balances/state; completion is time-segmented, idempotent, transactional, notified once, API-fallback capable, and restored from PostgreSQL by deterministic BullMQ reconciliation. General ordered multi-item queues remain future work. |
| Energy production and consumption | Partially implemented | Server-side supply, demand, and efficiency affect authoritative production, including exact building-completion transitions, and appear in player/admin state. There is no allocation control or history. |
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
| New-player protection | Placeholder | Registration uses the current configured duration for `protectedUntil`, which is displayed in the galaxy browser, but `POST /api/fleet` still does not enforce protection against attacks or raids. |
| Administration and moderation | Partially implemented | Admin-only bounded player search and explicit read-only account/planet state inspection are connected, sensitive fields are allowlisted out, authoritative state is settled on read, and each detail open is audited. Earlier status/rename/job-management features and their broader semantics remain prototype scope. |
| Game configuration and balancing | Partially implemented | Six values are editable and stored. Economy, research, and fleet speeds are used, and registration now uses configured protection hours; `universeSpeed` and `maxPlanetsPerPlayer` remain unused. |
| Administrative audit records | Partially implemented | Player-state detail opens and selected admin mutations call `logAudit`; safe inspection records contain no credential/token metadata. Coverage, failed-delete semantics, retention, and tamper evidence remain incomplete. |
| Background jobs and timed events | Partially implemented | Building completion now treats PostgreSQL as authoritative, uses deterministic BullMQ wake-ups, reconciles missing/stale jobs on startup and every 30 seconds, and claims the transition idempotently. Research, shipyard, and fleet timers retain the earlier recovery/idempotency limitations. |
| Graphics and visual assets | Placeholder | Visuals consist of CSS, a client-generated CSS starfield, the satellite emoji in navigation, and `favicon.ico`. No planet, ship, building, map, audio, or other production art inventory exists. |
| Automated testing | Implemented for the trusted slice | Guard/unit tests and isolated PostgreSQL integration suites cover configuration, failure boundaries, auth/provisioning, production/building concurrency, completion/reconciliation, and admin RBAC/allowlists. An opt-in disposable full-stack harness proves the complete slice and restart persistence; broader UI/gameplay coverage remains incomplete. |
| Security, validation and rate limiting | Partially implemented | bcrypt, random digest-backed sessions, hashed email-verification tokens, active-account checks on every protected request, HttpOnly/SameSite cookies, Helmet, CORS, Zod, CSRF header, normalized errors, and rate limits protect the slice. Password-reset token storage, proxy/IP policy, host-published local infrastructure, and broader abuse controls still need work. |
| Accessibility and responsive behaviour | Partially implemented | Semantic headings/labels, focus-visible styles, `lang="en"`, flexible grids, a stacked mobile shell, and reduced-motion handling exist. There are no audits/tests, no live-region announcements, no mobile table overflow treatment, and no verified contrast/keyboard/screen-reader pass. |
| Deployment and operational documentation | Partially implemented | Dockerfiles, local Compose, `.env.example`, separate liveness/readiness endpoints, migration-on-start, backup notes, and a disposable restart harness exist. Compose honors documented connection/health settings and supports loopback/random-port isolation, but exposed local-service defaults, unpinned images, CI/CD, TLS, monitoring, restore rehearsal, and rollback/runbooks remain future work. |

## Repository map

Generated build output is tracked only for `packages/shared/dist`; other build products and dependency directories are excluded.

```text
.
├── .dockerignore                 Docker build-context exclusions
├── .env.example                  documented local/default environment values
├── .gitignore                    repository-wide generated/secret exclusions
├── README.md                     overview, run, test, backup, and deployment claims
├── docker-compose.yml            PostgreSQL, Redis, Mailpit, API, worker, web
├── docker-compose.e2e.yml        disposable restart-test overrides
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
│   │   │       ├── 20260904150000_add_build_queue_cost_snapshot/migration.sql
│   │   │       └── migration_lock.toml
│   │   └── src
│   │       ├── app.ts            middleware and router composition
│   │       ├── server.ts         HTTP listener
│   │       ├── lib               auth, mail, Prisma, Redis/BullMQ clients
│   │       ├── middleware        session/RBAC/CSRF checks
│   │       ├── routes            auth, game, social, public, and admin REST routes
│   │       ├── services          config, provisioning, production, completion, admin state
│   │       ├── *.test.ts         route integration tests
│   │       └── testSetup.ts      guarded cleanup for isolated DB-backed tests
│   ├── worker
│   │   ├── Dockerfile
│   │   ├── jest.config.js
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src
│   │       ├── index.ts          four workers, building reconciler, liveness/readiness
│   │       ├── prisma.ts, redis.ts, queues.ts
│   │       ├── processors        build, research, shipyard, and fleet resolution
│   │       ├── buildingCompletion.ts, buildingReconciler.ts
│   │       ├── *.test.ts         processor/completion/reconciliation tests
│   │       └── testSetup.ts      same isolated-database guard as API tests
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
├── scripts                       disposable vertical-slice harness and safety boundary
├── test                          root safety and source-boundary tests
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
| Authentication/mail | bcryptjs 2.4.3, random digest-backed PostgreSQL sessions/tokens, Nodemailer 9.0.1 |
| Data | PostgreSQL 16 Alpine, Prisma Client/CLI 5.22.0 |
| Timers/jobs | Redis 7 Alpine, BullMQ 5.81.4, ioredis 5.11.1 |
| Local mail | Mailpit `latest` image, SMTP on 1025 and web UI on 8025 |
| Tests | Node test runner for root/shared tests; Jest 29, ts-jest, Supertest for isolated API/worker integration; disposable Compose vertical-slice harness |
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
- PostgreSQL stores authoritative game and workflow state. Redis stores delayed BullMQ wake-ups; the building worker reconciles every pending PostgreSQL construction into a deterministic live job on startup and every 30 seconds.
- Resource production is not a recurring job. It advances under a PostgreSQL planet-row lock on owned/admin planet reads, before building spends/cancellation, and at exact building-completion boundaries.

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
| `/resend-verification` | `apps/web/src/app/(public)/resend-verification/page.tsx` | Connected enumeration-safe verification recovery form. |
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
| `/game/planets/[planetId]/buildings` | Authoritative resources/rates, single active construction, auto-refresh at completion, enqueue and cancel. |
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
| `/admin/users` | Admin-only bounded search and explicit read-only account/planet-state inspection. |
| `/admin/announcements` | List, create, delete. Both moderators and admins can mutate. |
| `/admin/config` | View all values; admin-only edits. |
| `/admin/jobs` | View delayed/failed jobs; admin-only removal. |
| `/admin/security` | Last 100 security events. |
| `/admin/audit` | Last 200 selected admin actions. |

There is no UI for the existing message-delete or alliance-delete endpoints. Earlier account status/rename API mutations remain available but are deliberately absent from the read-only player-state page.

## REST API inventory

All mutating requests pass the global custom-header check in `requireCsrfHeader` (`apps/api/src/middleware/auth.ts:60`). “Connected” means called by a current page or Docker healthcheck.

| Method and path | Auth | Implementation status |
| --- | --- | --- |
| `GET /healthz` | Public | Connected liveness probe; does not claim dependency readiness. |
| `GET /readyz` | Public | Connected readiness probe; checks PostgreSQL and Redis. |
| `POST /api/auth/register` | Public + auth limiter | Connected; atomically creates the normalized pending account, exactly one homeworld/starter state, and hashed verification token before attempting mail. |
| `POST /api/auth/resend-verification` | Public + auth limiter | Connected; returns one generic response, applies cooldown/rate limits, and rotates the hashed token atomically for eligible accounts. |
| `POST /api/auth/verify-email` | Public + auth limiter | Connected; atomically consumes one hashed/legacy-compatible token and activates the user. |
| `POST /api/auth/login` | Public + auth limiter | Connected; normalizes email, equalizes unknown-account password work, checks verified/active status, and creates a random digest-backed DB session/cookie. |
| `POST /api/auth/logout` | Public with optional session cookie | Connected and idempotent; revokes only the presented session and clears the cookie. |
| `GET /api/auth/me` | Player | Connected; returns middleware user projection. |
| `POST /api/auth/forgot-password` | Public + auth limiter | Connected; enumeration-resistant response, but mail failures are hidden. |
| `POST /api/auth/reset-password` | Public + auth limiter | Connected; changes hash, consumes token, and revokes all sessions transactionally. |
| `GET /api/planets` | Player | Connected; syncs and lists every owned planet. |
| `GET /api/planets/:id` | Owning player | Connected; syncs resources and returns buildings, units, queues, energy, storage. |
| `PATCH /api/planets/:id` | Owning player | Connected; trims and limits name to 40 characters. |
| `GET /api/planets/:planetId/buildings` | Owning player | Connected; settles due completion/production and returns authoritative balances, rates, storage, catalog, levels, and active construction. |
| `POST /api/planets/:planetId/buildings` | Owning player | Connected; under a planet lock enforces one active item, requirements and non-negative balance, then atomically deducts and snapshots cost before best-effort deterministic scheduling. |
| `DELETE /api/planets/:planetId/buildings/:queueItemId` | Owning player | Connected; serializes against completion, atomically cancels and refunds 50% of the stored accepted cost, then removes Redis work best-effort. |
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
| `GET /api/admin/users` | Admin | Connected to the read-only player-state page; trimmed username/email/exact-ID search with bounded deterministic pagination and an explicit result allowlist. |
| `GET /api/admin/users/:id` | Admin | Connected; returns an explicit account/planet state DTO, settles authoritative planet state, and records one `PLAYER_STATE_VIEWED` audit event. |
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

Async handlers and centralized terminal error middleware normalize expected Prisma/validation/conflict failures, return safe JSON for unexpected failures, redact sensitive log material, and retain a JSON 404 fallback.

## Database models and relationships

`apps/api/prisma/schema.prisma` defines PostgreSQL as the only durable game database. The migrations are ordered as the initial schema, `GATE_TRAVEL`, then the building accepted-cost snapshot used for deterministic cancellation refunds.

| Model | Purpose and relationships |
| --- | --- |
| `User` | Unique email/username, bcrypt hash, role/status, verification/protection/activity timestamps. One-to-many planets, sessions, verification tokens, sent/received messages, notifications, audit logs, security events, and fragments; optional alliance membership. |
| `Session` | SHA-256 digest of a random bearer cookie, user FK with cascade, 14-day expiry, IP/user-agent. Valid pre-checkpoint plaintext sessions are upgraded on use; there is no cleanup/list/revocation UI. |
| `VerificationToken` | Unique token storage for email verification or password reset; new email-verification tokens are SHA-256 digests with one-time expiry/use state and legacy compatibility, while password-reset tokens retain the earlier plaintext implementation. |
| `Planet` | Owner FK, unique galaxy/system/slot, environment, floating-point resources and production timestamp. Owns buildings/queues/units/missions/debris/fragments/gate. |
| `Building` | Unique `(planetId,key)` and level; planet FK/cascade. Keys are strings rather than database enums/FKs to definitions. |
| `BuildQueueItem` | Planet, string building key, target level, exact accepted Alloy/Heliox/Aether cost snapshot, timestamps/status, optional deterministic Redis job ID. |
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

1. The register page posts email, username, and password. Email is trimmed/lowercased, username is trimmed and remains case-sensitive, and bcrypt uses cost 12. One transaction creates the pending user, homeworld, starter buildings, and digest-backed verification token, retrying bounded coordinate conflicts.
2. The verification page posts the raw URL token; only its digest is normally stored. Atomic one-time consumption activates the account. A generic, throttled resend path rotates eligible tokens without revealing account existence, and registration reports delivery failure without rolling back committed state.
3. Login trims/lowercases email, performs a fixed dummy-hash comparison for unknown accounts, and rejects pending/suspended/banned users with stable codes. `createSession` stores the SHA-256 digest of a random 32-byte token and sets the raw `eonrover_sid` cookie HttpOnly, SameSite=Lax, path `/`, with a 14-day expiry. Secure is enabled only when production and `COOKIE_SECURE` is not `false`.
4. `requireAuth` resolves digest-backed sessions (and upgrades valid legacy plaintext sessions), checks expiry plus verified/active status on every request, revokes invalidated sessions, and attaches a reduced user. It updates `lastActiveAt` best-effort.
5. `requireRole` protects admin endpoints. Web layouts improve navigation but do not form the security boundary.
6. Password reset consumes a one-hour token, changes the hash, and deletes all sessions in one transaction.

Security positives: passwords never leave the auth handler after hashing/verification; auth/admin responses use explicit projections without password hashes, bearer tokens, sessions, or internal job IDs; cookies are HttpOnly; writes require a non-simple custom header; CORS allows one configured web origin; public verification-resend and password-reset responses are enumeration-resistant.

Remaining gaps include plaintext password-reset tokens, no password breach/strength rules beyond length, intentionally case-sensitive usernames, no session rotation/cleanup/management UI, and no proxy trust plan.

## Existing game systems and formulas

Definitions live in `packages/shared/src/constants.ts`; pure calculations live in `packages/shared/src/formulas.ts`.

### Economy and time

- Starting resources: 500 Alloy, 300 Heliox, 0 Aether (`STARTING_RESOURCES`, `constants.ts:419`). Registration also creates Alloy Mine 0, Heliox Extractor 0, and Solar Array 1 (`auth.ts:49`, `auth.ts:92`).
- Building/research costs: each component is `round(baseCost * growth^(targetLevel-1))` (`scaledCost`, `formulas.ts:15`).
- Building time: `max(round(((alloy + heliox) / (2500 * (1 + researchLabLevel)) / economySpeed) * 3600), 15)` seconds (`buildingDurationSeconds`, `formulas.ts:40`). A research lab, rather than a dedicated construction building, accelerates construction.
- Research time: `max(round(((alloy + heliox + 2*aether) / (1000 * (1 + labLevel)) / researchSpeed) * 3600), 30)` seconds (`researchDurationSeconds`, `formulas.ts:53`).
- Shipyard time per unit: `max(round(baseSeconds / max(1, log2(shipyardLevel+2)) / economySpeed), 10)` (`shipyardDurationSeconds`, `formulas.ts:63`).
- Hourly production: 30/20/3 base rate for Alloy/Heliox/Aether, multiplied by `level * 1.1^level * planetTypeMultiplier * economySpeed * researchBonus` (`hourlyProduction`, `formulas.ts:79`). The caller always uses the default research bonus 1, so economy research descriptions do not affect output.
- Storage: `round(10000 * 1.5^storageLevel)` (`storageCapacity`, `formulas.ts`). Production is capped; a storage-building completion settles the old-cap and new-cap time segments separately. Delivery, loot, and refund cap policy is not generalized yet.
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
- Default universe settings are speed multipliers 1, protection 72 hours, and maximum 9 planets (`DEFAULT_UNIVERSE_CONFIG`, `constants.ts`). Economy, research, fleet speed, and configured registration protection duration currently affect behavior.

## Server-authority assessment

The intended authority boundary is clear and mostly located correctly:

- The browser submits action choices, not resource balances, queue completion timestamps, loot, exploration rolls, combat outcomes, or final travel duration.
- The API loads owned rows, computes costs/fuel/durations, deducts state, and stores server timestamps.
- The worker uses server-side formulas and randomness to complete queues and missions.
- UI countdowns (`useTicker`) are display-only; they do not complete work.

The trusted resource/building slice is authoritative under concurrency and failure: planet-row locking serializes settle/spend, one active building prevents mixed-queue ambiguity, persisted costs drive refunds, completion claims and all side effects share a transaction, and PostgreSQL repairs missing BullMQ building jobs. The following limitations remain in systems outside that slice:

- Research, shipyard, and fleet spend paths still perform “read/check, then unconditional decrement” patterns that can race; the building path no longer does.
- Fleet ship counts are checked before a transaction and then decremented without a `count >= requested` predicate (`fleet.ts:63-69`, `fleet.ts:130-137`).
- Redis is published on host port 6379 with no authentication in Compose. Anyone who can reach it can manipulate trusted job payloads such as research `userId` and shipyard `perUnitSeconds`.
- Research, shipyard, and fleet processors do not consistently claim a pending row before side effects. Building completion now does.
- Worker payloads carry values that should be derived from PostgreSQL/definitions: research `userId` and shipyard `perUnitSeconds` (`researchProcessor.ts:15`, `shipyardProcessor.ts:32`).
- New-player protection is cosmetic: the fleet route does not enforce `protectedUntil` for attack/raid.
- Mission-specific validation is incomplete: DEPLOY can transfer ships to someone else's planet, self-attacks are allowed, and ESPIONAGE/RECYCLE/EXPLORE do not require the intended vessel.

Server-calculated, exploit-resistant, and retry-safe are accurate for the checkpointed registration/resource/single-building/admin slice, but not for the wider prototype.

## Background jobs, queues, and timed-event handling

`apps/api/src/lib/redis.ts:12` creates four BullMQ queues:

| Queue | Created by | Worker effect |
| --- | --- | --- |
| `build-queue` | Building route and reconciler | Uses persisted timing/state to atomically complete exactly once, settle split production, update the level, and notify. |
| `research-queue` | Research route | Upserts account research using job `userId`, completes row, notifies. |
| `shipyard-queue` | Shipyard route and processor | Adds one unit, decrements remaining, schedules the next unit, eventually notifies. |
| `fleet-queue` | Fleet route and processor | Resolves arrival/mission effect, schedules return, or restores ships/cargo at origin. |

Building creation first commits PostgreSQL state and then best-effort enqueues a deterministic Redis job. The worker scans all pending building rows at startup and every 30 seconds, preserves live jobs, replaces failed/missing jobs, and writes the deterministic ID back. Research, shipyard, and fleet flows do not yet have equivalent reconciliation or an outbox.

Redis has a named volume and snapshot rule `--save 60 1`. Building correctness no longer depends on that snapshot because PostgreSQL queue timestamps/status are the recovery source; other queues can still diverge after Redis loss or a cross-store failure.

Processor-specific hazards:

- Building completion locks planet then construction, conditionally claims `PENDING`, and commits production, level, status, and one notification together. Research retains the earlier non-claiming behavior.
- Shipyard commits the unit increment before scheduling/updating the next unit. A failure in between causes a retry to add the same unit again.
- Fleet arrival applies effects before `scheduleReturn` changes status. Return jobs are processed by job name even if the mission is already `COMPLETE`; a retry can restore ships/cargo again (`fleetProcessor.ts:394-403`).
- Admin job deletion removes only Redis state (`admin.ts:170`), with no queue-record transition or refund.
- Worker `/healthz` is liveness-only; `/readyz` independently checks PostgreSQL and Redis and is used by Compose.

## Docker services, persistence, and local development

`docker-compose.yml` defines:

| Service | Ports | Persistence/start behavior |
| --- | --- | --- |
| `postgres` | Configurable host port, container 5432 | `postgres_data`; PostgreSQL 16; health via `pg_isready`. |
| `redis` | Configurable host port, container 6379 | `redis_data`; unauthenticated Redis 7 with periodic RDB snapshots. |
| `mailpit` | Configurable HTTP/SMTP host ports | `mailpit_data`; image is unpinned `latest`. |
| `api` | Configurable `PORT` | Waits for infrastructure; container command runs `prisma migrate deploy`, then the development-only optional admin provisioner, then Express; readiness checks PostgreSQL/Redis. |
| `worker` | Internal configurable health port | Waits for API and infrastructure; starts four workers plus building reconciliation; readiness checks PostgreSQL/Redis. |
| `web` | Configurable host port, container 3000 | Builds browser API URL into Next bundle and waits for API. |

Expected Docker run path from `README.md` is `cp .env.example .env` followed by `docker compose up --build`. Expected direct-development path is npm install, build shared, apply Prisma migrations, then run API, worker, and web in separate terminals with PostgreSQL, Redis, and Mailpit already available.

Game data persists in PostgreSQL. Redis contains transient wake-up state; building jobs are recoverable from PostgreSQL, while other queue types still depend on Redis continuity. Mailpit persistence is local convenience only.

The README's backup commands are likely broken when values exist only in `.env`: host-shell expansion of `$POSTGRES_USER`/`$POSTGRES_DB` occurs before Compose applies `.env` to the service. Backups and restores are not tested or automated.

## Configuration and environment variables

No secret values were read. The documented names and behavior are:

| Variable | Consumer | Notes |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Compose | Used to configure PostgreSQL and assemble container `DATABASE_URL`; weak development fallbacks are supplied. |
| `DATABASE_URL` | Prisma API/worker runtime | Required outside Compose. Tests use only a separately validated `TEST_DATABASE_URL`; Compose assembles its internal URL from `POSTGRES_*`. |
| `TEST_DATABASE_URL`, `ALLOW_TEST_DATABASE_RESET` | API/worker tests | Both are required for destructive integration cleanup, and the decoded database name must end in `_test`. Runtime `DATABASE_URL` is never a fallback. |
| `REDIS_URL` | API/worker source | Defaults to local Redis in development/test; Compose passes through an override or uses `redis://redis:6379`. |
| `PORT` | API | Defaults 4000; Compose mapping and readiness probe follow it. |
| `NODE_ENV` | API/container | Controls Prisma singleton and cookie default; Compose defaults production. |
| `WEB_URL` | API | Single CORS origin and base for email links. |
| `COOKIE_SECURE` | API | `false` supports local HTTP even with production node mode. Must be true behind production HTTPS. |
| `SMTP_HOST`, `SMTP_PORT` | API mailer | Compose passes through overrides or uses Mailpit. Production validation requires a non-local STARTTLS endpoint; no username/password variables exist. |
| `MAIL_FROM` | API mailer | Sender address. |
| `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Development admin provisioner | All must be present; idempotently creates one active admin in non-production only without logging identity/credentials. No gameplay records are seeded. |
| `WORKER_HEALTH_PORT` | Worker | Defaults 4100; Compose readiness follows it. |
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
| Root guard/source tests, 25 tests | Database URL/reset safety, vertical-slice project/database/cleanup/redaction safety, and the read-only admin-page source boundary. | General browser/component/accessibility testing. |
| Shared, 23 tests | Existing formulas plus deterministic timestamp production, precision, validation, energy and storage behavior. | Broader combat/research/shipyard/fleet formula edge cases. |
| API config/failure boundaries, 22 tests | Runtime parsing, production restrictions, normalized failures/log redaction, liveness and readiness. | Proxy behavior and authenticated SMTP. |
| API integration, 106 tests | Existing routes plus atomic registration, email recovery, session hardening, resource/building concurrency and completion, and admin player-state RBAC/allowlists/audit. | Research/shipyard/fleet/social concurrency and complete authorization matrices. |
| Worker config/health, 16 tests | Runtime parsing and separate liveness/readiness behavior. | Operational telemetry beyond probes. |
| Worker integration, 27 tests | Existing fleet cases plus building transition timing, idempotency, race behavior and reconciliation. | Research/shipyard/fleet general idempotency and recovery. |
| Full stack | One disposable scenario | Registration → Mailpit verification → login/session digest → homeworld → building completion → production → logout/login → full restart → admin inspection/audit, with cleanup and unrelated-container checks. |

The root `npm test` runs 219 unit/integration tests. API/worker integration suites fail closed unless an explicitly opted-in `TEST_DATABASE_URL` passes the test-database guard; they never fall back to runtime `DATABASE_URL`. Build verification remains the separate `npm run build` command. The known ESLint 9 configuration failures remain outside this checkpoint.

## Confirmed defects, inconsistencies, and security concerns

### Remaining correctness and game-rule risks outside the trusted slice

1. Research, shipyard, fleet dispatch/arrival/return, colonisation, combat, espionage, recycling, delivery storage, and alliance ownership still have the original concurrency, idempotency, recovery, or rule-enforcement gaps.
2. New-player protection is stored using the configured duration but is not enforced for attack/raid. `maxPlanetsPerPlayer` and `universeSpeed` remain unused.
3. Advertised research production/propulsion effects remain disconnected, and several advanced mission types lack vessel, target, ownership, or coordinate constraints.

### Remaining security and operations concerns

1. The local Compose stack intentionally host-publishes development PostgreSQL/Redis/Mailpit; it is not a production deployment template.
2. Password-reset tokens remain plaintext at rest, expired auth rows have no maintenance cleanup, rate limiting is process-local, and proxy/IP behavior is not defined for deployment.
3. Research/shipyard jobs still trust fields from reachable Redis, and admin removal of non-building jobs can strand PostgreSQL workflow state.
4. Audit retention is not durable, backup/restore has not been rehearsed, and production CI/CD, TLS, monitoring, rollback and incident runbooks are absent.

### Remaining UI, type, and tooling concerns

1. Web transport types still duplicate backend/shared contracts, reports remain raw JSON, and broader accessibility/responsive/browser coverage is incomplete.
2. Tracked `packages/shared/dist` requires deliberate regeneration whenever source changes; the checkpoint includes and reviews all generated counterparts for the changed source.
3. API/worker ESLint 9 configuration remains non-self-contained and is a known failure outside this checkpoint. No lint repair is included.

## Working functionality versus appearances

### What is genuinely connected

- Atomic database-backed registration/homeworld provisioning, recoverable email verification, hardened login/session lookup/logout, and reset-token processing.
- Row-locked timestamp resource calculations with energy, storage, fractional precision, and exact building-transition segments.
- Atomic single-item building start/cancellation plus durable, idempotent, reconciled completion and one notification.
- Disposable six-service verification of the full player loop, logout/login, full-stack restart, and cleanup.
- Admin-only bounded player search and audited read-only authoritative account/planet inspection.
- Queue creation and worker code for research, shipyard, and fleet actions, which remain outside the trusted guarantee.
- Live planet, galaxy, social, leaderboard, report, gate, notification, public-stat/news, and admin pages backed by API calls.
- PostgreSQL data volume and Redis/Mailpit volumes in Compose.
- Role checks on administrator APIs, with stricter admin-only checks for selected mutations.

### What only appears complete or behaves as a prototype

- New-player protection is displayed but provides no protection.
- Several research descriptions promise bonuses that never affect gameplay.
- Research/shipyard/fleet queue countdowns can still become disconnected from Redis; the building page refreshes at its due timestamp and the API/worker recover from PostgreSQL.
- Fleet mission names exist across the UI, API, and worker, but mission prerequisites/policies and retry safety are incomplete.
- Espionage “accuracy” does not change revealed information.
- `isVisible` suggests public gate visibility, but the galaxy response does not expose gates.
- Restart persistence is verified for the trusted account/homeworld/session/resource/building/admin slice, not for every advanced job processor.
- “Production-ready images” and deployment guidance do not account for exposed infrastructure, weak defaults, SMTP limitations, operational recovery, or monitoring.
- Privacy, terms, support, and game-guide pages are static content, not connected operational/legal systems.

No hard-coded or synthetic players, planets, rankings, messages, audit records, or gameplay records were found. The only provisioner creates one administrator from environment variables in non-production and skips safely when any value is absent (`apps/api/prisma/seed.ts`). Tests create temporary records only inside validated disposable databases/stacks and remove their scoped state.
