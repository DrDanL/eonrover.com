# Eon Rover codebase map

## Scope and inspection record

This document was refreshed for the Stage 6C research completion/recovery work on 2026-09-07. Areas outside the trusted slice retain the original 2026-09-04 prototype assessment unless explicitly updated below.

- No `AGENTS.md` exists in this repository.
- Stage 0 destructive test guards require `TEST_DATABASE_URL`, `ALLOW_TEST_DATABASE_RESET=1`, and a test-named database before cleanup can run.
- Runtime configuration, liveness, readiness, and normalized API error boundaries are implemented for the API and worker.
- The checkpoint verification covers the full unit/integration suite, workspace build, Compose parsing, clean migration install, and an opt-in disposable six-service restart scenario.
- Stage 5A centralises energy/category definitions, gates new continuous demand inside the existing planet lock, and exposes a categorised, accessibility-oriented building screen without changing balance values.
- Stage 5B adds one allowlisted command snapshot and a responsive authenticated shell with live presentation-only resources, owned-planet switching, global construction state, and a command-focused overview.
- Stage 5C1 centralises building-only prerequisites, gates starts from persisted completed levels inside the planet lock, and exposes ordered cross-category lock guidance without adding field capacity.
- Stage 5C2 persists a positive planet capacity, derives completed/reserved use from authoritative rows, blocks over-capacity starts inside the planet lock, and presents defensive full/legacy-over-capacity states without adding expansion gameplay.
- Stage 6D enables the authenticated research workflow with authoritative start/cancellation, account-wide shell state and completion refresh; Stage 6C's PostgreSQL-authoritative completion/reconciliation remains the authority.
- Stage 7A provides a typed, read-only Shipyard catalogue for the seven persisted ship keys. Existing Shipyard POST/worker queue behaviour is deliberately not exposed by the player Shipyard route until the Stage 7B–7D authoritative construction workflow is implemented.
- Stage 7B adds API-only server-authoritative Ship batches: serializable account → planet → queue locks, one pending batch per planet, immutable accepted economics/duration snapshots, exact 50% cancellation refunds, and best-effort deterministic Redis wake-ups. Completion/reconciliation and player controls remain deferred.
- Stage 7C makes Shipyard completion PostgreSQL-authoritative and idempotent: overdue API fallback and a bounded startup/30-second reconciler repair missing deterministic BullMQ wake-ups; player controls remain deferred.
- Stage 7D1 enables Shipyard player controls for accepted batches (quantity 1–100, one pending batch per planet, persisted timing/refund presentation and cancellation). PostgreSQL remains authoritative; BullMQ only wakes completion. Browser visual smoke verification is deferred.
- Stage 8B1 prepares only persistence and pure validation for a future owned-planet DEPLOY lifecycle; no Fleet route, worker, or player control is enabled.
- Stage 8B2a deliberately disables unsafe legacy Fleet API routes and worker job consumption; queued legacy jobs and database rows are preserved pending the trusted deploy lifecycle.
- Stage 8B2b adds an internal-only, serializable owned-planet DEPLOY launch transaction. PostgreSQL synchronises and reserves only the origin's ships and Heliox before it stores canonical server-derived snapshots; no public API or player control is enabled.
- Stage 8B2c adds internal-only, serializable DEPLOY arrival completion. It transfers only the persisted canonical manifest to the canonical owned destination, marks the mission complete, and records one notification atomically; early, legacy, malformed, terminal, and ownership-inconsistent rows are no-ops.
- Stage 8B2d adds an internal-only deterministic deploy-arrival wake-up producer. It reads committed canonical mission state and creates a minimal, deploy-specific BullMQ wake-up without changing PostgreSQL.
- Stage 8B2e wires that wake-up after the committed deploy launch only, and registers a dedicated deploy-arrival worker that trusts only the mission ID, uses PostgreSQL for due-time and completion state, and safely reschedules early delivery. There is no deploy reconciliation, restart repair, Fleet API, or player control yet.
- Stage 8B2f adds startup and 30-second non-overlapping reconciliation for canonical outbound DEPLOY rows, bounded to 100. It directly completes overdue rows or restores missing deterministic future wake-ups from PostgreSQL; legacy rows remain untouched and Fleet API/UI remains unavailable.
- Stage 8C1 adds authenticated, CSRF-protected owned-planet DEPLOY command-summary and launch routes. They project only allowlisted authoritative state and settle due canonical arrivals before a read; legacy generic Fleet routes and the player Fleet screen remain unavailable pending Stage 8C2.
- Stage 8C2a connects the Fleet page to the authoritative owned-planet DEPLOY API: a player selects one same-account destination, speed and available ships, then views the accepted persistent lifecycle. Cargo, recall, cross-player targets and every other mission type remain unavailable. Browser visual smoke verification is deferred, not passed.
- Stage 9B5b registers only the dedicated canonical colonisation-arrival worker. It trusts only a mission ID, calls the shared PostgreSQL-authoritative completion transaction, and reschedules early jobs from persisted arrival time; startup repair and reconciliation remain pending.
- Stage 9B5c adds startup and 30-second non-overlapping reconciliation for canonical outbound colonisation rows, bounded to 100. It directly completes overdue rows or restores missing future deterministic wake-ups from PostgreSQL; legacy rows remain untouched and colonisation remains unavailable to players.
- Stage 9C1 adds authenticated, CSRF-protected owned-origin colonisation command-summary and launch routes. They expose only allowlisted same-system availability and canonical state, settle due arrivals before reads, and preserve accepted PostgreSQL launches if Redis wake-up dispatch fails. Generic Fleet routes remain unavailable and no colonisation control has been added to the existing Fleet page.
- Stage 9C2 adds a compact Colonise mode to the existing Fleet page. It selects only API-provided same-system slots and confirms one server-authoritative Colony Ship launch; cargo, recalls, and all other colonisation controls remain unavailable.
- Stage 10B1 adds shared pure Transporter-only cargo-capacity and fixed-speed round-trip planning. Stage 10B2 persists nullable canonical transport snapshots, owned endpoints, and a transport-specific lifecycle phase without reinterpreting legacy missions. Transport launch, delivery, return, scheduling, recovery, API, and UI remain unavailable.
- Stage 10B3 adds an internal serializable same-owner transport launch transaction. It synchronises and reserves only the origin's Transporters, cargo, and outbound-plus-return Heliox before persisting canonical transport snapshots; no scheduler, worker, API, or player control is active.
- Stage 10B4 adds an internal PostgreSQL-authoritative settlement transaction for canonical transport phases. It delivers cargo all-or-nothing after authoritative destination-capacity checks, waits without loss when full, and restores Transporters only on due return; no scheduler, worker, API, or player control is active.
- Stage 10B5a adds the isolated, currently unconsumed `transport-arrival-queue`. Internal transport launch and successful delivery dispatch deterministic post-commit arrival and return wake-ups; Redis failure never reverses PostgreSQL state, and worker/reconciliation/API/UI work remains pending.
- Stage 10B5b registers only the dedicated `transport-arrival-queue` consumer. It trusts only the mission ID, derives lifecycle timing from PostgreSQL, reschedules early jobs without mutations, and calls the shared canonical transport settlement transaction; transport reconciliation, API, and UI remain pending.
- Stage 10B6 adds startup and 30-second non-overlapping reconciliation for active canonical transport phases, bounded to 100. It settles due delivery/return work directly and restores only missing future deterministic wake-ups from persisted timing; legacy fleet work remains dormant and player transport access remains pending.
- Stage 10C1 adds allowlisted `GET`/`POST /api/fleet/transports` commands for same-account Transporter missions. They expose only safe origin, destination, capacity, active-phase and accepted-cargo presentation state; generic Fleet routes stay disabled and no player transport UI is active.
- Stage 10C2 adds a compact Transport mode to the existing Fleet page. It submits only an owned destination, Transporter quantity, and cargo through the allowlisted transport API; it presents authoritative lifecycle state, performs one expiry refresh, and safely refreshes while destination capacity is unavailable. Recall and cancellation remain unavailable.
- The disposable stack uses a generated `eonrover-e2e-*` project, random loopback ports, project-scoped volumes, fixed disposable database credentials, output redaction, and scoped cleanup.
- ESLint 9 configuration failures remain a known issue outside this milestone; lint configuration was not repaired.

The trusted registration-to-admin-inspection slice is verified against live PostgreSQL, Redis, Mailpit, API, worker, and web containers. Broader prototype systems remain outside that end-to-end guarantee.

## Current application in one paragraph

Eon Rover is a compact TypeScript npm-workspaces monorepo containing a Next.js browser client, an Express REST API, a PostgreSQL schema accessed through Prisma, a Redis/BullMQ timed-job layer, and a separate BullMQ worker. Its trusted vertical slice now provides atomic account/homeworld provisioning, recoverable email verification, digest-backed database sessions, row-locked timestamp production, hard server-authoritative prerequisite, field-capacity and energy gating, atomic single-item building start/cancellation, PostgreSQL-authoritative idempotent completion with Redis reconciliation, a coherent authenticated command shell and planet overview, restart verification, and an audited read-only administrator player-state view. Research, shipyard, fleet, social, deployment, and other advanced systems remain a broad prototype rather than production-ready gameplay.

## Area-by-area assessment

The classifications below use the requested vocabulary. “Implemented and connected” means there is a frontend-to-API-to-persistence path, not that the area is production-ready.

| Intended area | Classification | Evidence and qualification |
| --- | --- | --- |
| Public website | Partially implemented | Landing, features, guide, news, stats, leaderboard, auth, contact, privacy, and terms routes exist under `apps/web/src/app`. News, stats, and leaderboard use real API data; marketing/legal/contact copy is static and should not be treated as final policy or support infrastructure. |
| User registration and login | Implemented and connected | Registration atomically creates one user, homeworld, starter buildings, and digest-backed verification token. Email is trimmed/lowercased, usernames are trimmed with documented case-sensitive uniqueness, login uses a generic credential failure path, and raw random session tokens are stored only as SHA-256 digests. |
| Email verification and password reset | Partially implemented | Email verification has hashed one-time tokens, expiry, atomic consumption, enumeration-safe throttled resend, explicit delivery results, and a recovery UI. Password reset remains the earlier prototype flow and production SMTP authentication/TLS is not configurable. |
| Player account and security management | Partially implemented | The settings page shows account data, supports logout, and links to reset-password. There is no session list/revocation, in-session password change, email change, account deletion, MFA, or recovery-code flow. |
| Planet management | Partially implemented | Registration atomically creates exactly one 180-field homeworld with a bounded coordinate-collision retry and the configured protection duration; prototype colonisation uses the same fixed capacity. The authenticated shell selects only owned planets and preserves supported planet-section routes; the overview presents identity, economy, distinct field/energy constraints, development, and deterministic guidance. Renaming remains in the API, colonisation remains prototype scope, and there is no abandon/transfer flow, field-expansion mechanic, or robust colonisation-limit enforcement. |
| Resource production and storage | Implemented for the trusted slice | `syncPlanetResources` advances elapsed server-time production under a per-planet PostgreSQL row lock, persists fractional balances/timestamps, applies energy and production storage caps, and prevents duplicate accrual under concurrent reads/spends. Research bonuses and non-production delivery/loot storage policy remain outside the slice. |
| Buildings and construction queues | Implemented for the trusted slice | One active building item per planet is enforced. Start derives ordered prerequisites and completed field use from persisted building levels, reserves accepted pending work from authoritative queue rows, checks fields and then projected energy under the planet lock before settlement/deduction, and never trusts browser-supplied totals. The allowlisted API and categorised web interface expose complete requirements, current levels, costs, field/energy projections, availability priority, countdown and refund information without internal job IDs. General ordered multi-item queues remain future work. |
| Energy production and consumption | Implemented for the trusted building slice | One shared pure model calculates supply, demand, available capacity, utilisation, production efficiency and upgrade projections. Demand-increasing starts are blocked only above capacity; exact capacity is accepted, while generators and zero-demand facilities remain buildable in legacy deficits. Allocation controls and history remain future work. |
| Research and technology progression | Partially implemented | A central typed catalogue, atomic account-wide start/cancellation, and durable PostgreSQL-authoritative completion are implemented. Completion locks account → origin planet → queue, applies persisted target/deadline and one notification atomically, and a 100-row startup/30-second reconciler restores deterministic BullMQ jobs. The authenticated catalogue remains read-only and the player interface is deferred to Stage 6D. Economy research has no production-boundary integration yet because no active/partial effect changes lazy production. |
| Shipyard and fleet construction | Partially implemented | API-only Shipyard batches use persisted snapshots, cancellation and PostgreSQL-authoritative, exactly-once batch completion. The Shipyard worker/API fallback and bounded reconciler use Redis only as a deterministic wake-up. Fleet remains a prototype. |
| Galaxy and solar-system navigation | Implemented read-only foundation | A protected Galaxy browser renders an allowlisted 12-slot projection. Shared bounds restrict browsing to galaxies 1–6, systems 1–400, and slots 1–12; public worlds expose only display name/type, username, and protection while unavailable owners are opaque. No target ID, mission state, or launch control is exposed. |
| Fleet missions and travel | Partially implemented | Legacy generic Fleet routes return an authenticated unavailable boundary and no worker consumes legacy jobs. The Fleet page supports one owned-planet DEPLOY at a time using only API-provided same-account destinations, speeds and ships; accepted state follows the existing PostgreSQL-authoritative persistent lifecycle. Cargo, recall, cross-player targets and every other mission type remain unavailable. Browser visual smoke verification is deferred. |
| Exploration | Partially implemented | `EXPLORE` is dispatched and has a server-side 20% Gate Fragment outcome. It lacks ship/target constraints, meaningful non-fragment outcomes, reports, and balancing controls. |
| Colonisation | API prepared, UI unavailable | Colony Ships have an attainable Shipyard-only prerequisite. Internal serializable launch reserves one ship and authoritative Heliox, persists canonical target/timing/characteristics/starter snapshots, and uses account plus coordinate locks and PostgreSQL constraints to protect the planet limit and target claim. Its post-commit best-effort wake-up uses a dedicated colonisation worker; PostgreSQL remains authoritative if Redis fails. The worker trusts only a mission ID, uses persisted arrival timing to reschedule early delivery, and calls the same completion transaction that creates one colony or records an occupied-target terminal failure. Startup and 30-second non-overlapping reconciliation scan up to 100 canonical outbound rows, complete overdue arrivals directly, and restore missing future jobs. Authenticated, CSRF-protected colonisation summary and launch routes project only safe same-system availability and canonical lifecycle state. Homeworld allocation skips active canonical reservations. The generic legacy mission remains disabled; the existing Fleet page has no colonisation control. |
| Espionage | Player command API, launch screen and canonical report interface available; legacy prototype remains unsafe | Shared rules constrain an intelligence-only mission to one Probe at fixed speed between distinct bounded same-galaxy coordinates, with deterministic outbound/return travel snapshots. Nullable canonical Probe origin/target/account references, manifest/fuel/duration snapshots, and a separate lifecycle phase persist alongside legacy rows under a one-active-per-origin database constraint. The launch transaction resolves only an active, verified, unprotected cross-player target by coordinates and reserves one Probe plus accepted round-trip Heliox. A due canonical arrival settles target production at its persisted boundary, creates one immutable filtered report and paired safe notifications; only a due return restores the reserved Probe. A dedicated worker and startup plus 30-second non-overlapping reconciliation consume and recover only deterministic Probe wake-ups; PostgreSQL remains authoritative if Redis fails. Galaxy exposes only public coordinate slots and hands a selected coordinate to the Fleet Espionage mode; that mode reads and launches only through the allowlisted Probe command API, then presents active phase/timing/report readiness. The Reports screen presents only immutable tiered disclosure data from canonical attacker-owned report reads; raw legacy player report routes remain unavailable. Browser visual verification is deferred. Legacy generic mission behavior remains unavailable for player use. |
| Combat | Canonical lifecycle, allowlisted API, and bounded player controls complete; legacy prototype remains unsafe | Fixed-speed Corvette-only launch reserves ships and round-trip Heliox against active, verified, unprotected same-galaxy targets. A versioned seeded resolver drives one serializable arrival transaction that locks target forces, applies losses, writes an immutable canonical result, and creates paired safe notifications; only surviving Corvettes return. Deterministic dedicated queue wake-ups, a processor, and startup plus 30-second bounded reconciliation recover missed arrivals/returns while PostgreSQL remains authoritative. Galaxy offers a coordinate-only Strike hand-off; Fleet submits only origin, coordinates, and Corvette count; Reports renders only immutable canonical combat results. Loot, cargo, debris, raids, recalls, and generic Fleet combat remain unavailable. |
| Debris and recycling | Partially implemented | Battles can create debris and `RECYCLE` can collect it. Heliox debris is always zero, recycler ships are not required, and concurrent recyclers can overdraw the field. |
| Alliances | Partially implemented | Create, open join, leave, list, membership, and roster UI are connected. There are no applications/invitations, permissions, rank changes, ownership transfer, or handling for a leader who leaves. |
| Messaging and notifications | Partially implemented | Compose/inbox/sent/read and notification list/read-all are connected. There is no player deletion/report/blocking flow, pagination, per-user anti-spam control, or complete event coverage. |
| Leaderboards | Implemented and connected | Public and protected boards compute a live score from planet count and building levels. The scoring model is minimal and recalculates by loading all active users and their planets/buildings. |
| New-player protection | Placeholder | Registration uses the current configured duration for `protectedUntil`, which is displayed in the galaxy browser, but `POST /api/fleet` still does not enforce protection against attacks or raids. |
| Administration and moderation | Partially implemented | Admin-only bounded player search and explicit read-only account/planet state inspection are connected, sensitive fields are allowlisted out, authoritative state is settled on read, and each detail open is audited. Earlier status/rename/job-management features and their broader semantics remain prototype scope. |
| Game configuration and balancing | Partially implemented | Six values are editable and stored. Economy, research, and fleet speeds are used, and registration now uses configured protection hours; `universeSpeed` and `maxPlanetsPerPlayer` remain unused. |
| Administrative audit records | Partially implemented | Player-state detail opens and selected admin mutations call `logAudit`; safe inspection records contain no credential/token metadata. Coverage, failed-delete semantics, retention, and tamper evidence remain incomplete. |
| Background jobs and timed events | Partially implemented | Building completion now treats PostgreSQL as authoritative, uses deterministic BullMQ wake-ups, reconciles missing/stale jobs on startup and every 30 seconds, and claims the transition idempotently. Research, shipyard, and fleet timers retain the earlier recovery/idempotency limitations. |
| Graphics and visual assets | Partially implemented | Visuals remain primarily CSS, the generated starfield, navigation emoji and `favicon.ico`; building cards use original inline SVG schematics and the overview adds an original CSS planet/orbit treatment. There is still no broader ship, map, audio, or production-art inventory. |
| Automated testing | Implemented for the trusted slice | Guard/unit tests and isolated PostgreSQL integration suites cover configuration, failure boundaries, auth/provisioning, production/building concurrency, completion/reconciliation, and admin RBAC/allowlists. An opt-in disposable full-stack harness proves the complete slice and restart persistence; broader UI/gameplay coverage remains incomplete. |
| Security, validation and rate limiting | Partially implemented | bcrypt, random digest-backed sessions, hashed email-verification tokens, active-account checks on every protected request, HttpOnly/SameSite cookies, Helmet, CORS, Zod, CSRF header, normalized errors, and rate limits protect the slice. Password-reset token storage, proxy/IP policy, host-published local infrastructure, and broader abuse controls still need work. |
| Accessibility and responsive behaviour | Partially implemented | Semantic headings/landmarks, focus-visible styles, `lang="en"`, a purpose-built mobile command menu, labelled resource/energy summaries and progress semantics, keyboard planet/category controls, descriptive graphics, live construction countdowns, and reduced-motion handling exist. Broader automated audits, mobile table treatment and a complete screen-reader pass remain future work. |
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
│   │       ├── services          config, provisioning, production, completion, internal deploy launch, admin state
│   │       ├── *.test.ts         route integration tests
│   │       └── testSetup.ts      guarded cleanup for isolated DB-backed tests
│   ├── worker
│   │   ├── Dockerfile
│   │   ├── jest.config.js
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src
│   │       ├── index.ts          four active workers, four reconcilers, liveness/readiness
│   │       ├── prisma.ts, redis.ts, queues.ts
│   │       ├── processors        build, research, shipyard, internal deploy arrival, plus dormant legacy fleet resolution
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
├── scripts                       safe local start/stop/log runners, reset runner, and disposable vertical-slice harness
├── test                          root safety and source-boundary tests
└── docs
    ├── codebase-map.md
    └── implementation-roadmap.md
```

## Technical stack and tools

The root requires Node.js 24 or newer and uses npm workspaces (`package.json`). The lockfile currently resolves notable packages as follows:

| Layer | Technology |
| --- | --- |
| Browser | Next.js 16.3.4 App Router, React/React DOM 19.2.8, TypeScript 5.9.3, handwritten global CSS |
| API | Express 4.22.2, TypeScript/CommonJS, Zod 3.25.76, Helmet 7, CORS, cookie-parser, express-rate-limit |
| Authentication/mail | bcryptjs 2.4.3, random digest-backed PostgreSQL sessions/tokens, Nodemailer 9.0.1 |
| Data | PostgreSQL 16 Alpine, Prisma Client/CLI 5.22.0 |
| Timers/jobs | Redis 7 Alpine, BullMQ 5.81.4, ioredis 5.11.1 |
| Local mail | Mailpit `latest` image, SMTP on 1025 and web UI on 8025 |
| Tests | Node test runner for root/shared tests; Jest 29, ts-jest, Supertest for isolated API/worker integration; tested local launcher and disposable Compose vertical-slice harness |
| Containers | Three multi-stage Node 24 Bookworm images plus Compose-managed infrastructure |
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
| `/game` | Resolves the persisted owned-planet selection and redirects to its overview; shows explicit no-planet and command-failure states. |
| `/game/planets/[planetId]` | Command overview driven by the shell snapshot: identity, projected economy display, storage timing/warnings, distinct field and energy capacity, building levels, construction, and deterministic next action. |
| `/game/planets/[planetId]/buildings` | Field and energy summaries, categorised authoritative building catalog, eligibility reasons, single active construction/refund details, auto-refresh at completion, enqueue and cancel. |
| `/game/planets/[planetId]/research` | Read-only account-wide research catalogue using the selected owned planet for its laboratory and resource context; scheduling is unavailable. |
| `/game/planets/[planetId]/shipyard` | Ship/defence catalog and batch enqueue. |
| `/game/planets/[planetId]/fleet` | Owned-planet DEPLOY page using the allowlisted Fleet API: one active deploy per origin, same-account destination/speed/ship selection and authoritative arrival presentation. Cargo, recall, cross-player targets and all other mission types remain unavailable; browser visual smoke verification is deferred. |
| `/game/galaxy` | Bounded, read-only 12-slot system browser using only safe public/unavailable occupancy data. |
| `/game/gates` | Fragments, gate activation, gate linking. |
| `/game/alliances` | Directory, membership, create, join, leave. |
| `/game/messages` | Compose, inbox, sent, mark read. |
| `/game/notifications` | List, mark one/all read. |
| `/game/leaderboard` | Protected top-100 board. |
| `/game/reports` | Combat and espionage records rendered mainly as raw JSON. |
| `/game/settings` | Account summary, logout, reset-password link; explicitly notes unavailable session management. |

The shell normally links Overview, Buildings, Galaxy, Messages, Alliance, Eon Gates, Reports, Leaderboard, Notifications, Settings, and permitted administrator access. Research, Shipyard, and Fleet remain directly routable prototype pages but are labelled `Coming later` rather than promoted as trusted gameplay because their queue/effect/recovery rules remain incomplete.

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
| `GET /api/planets/command-summary?planetId=...` | Owning player | Connected; at one explicit server time settles overdue building work, locks/synchronises the selected planet, and returns allowlisted identity/resources/storage/rates/energy/derived fields/buildings/construction plus owned-planet selector data. Invalid or unowned explicit IDs return 404. |
| `GET /api/planets/:id` | Owning player | Connected; syncs resources and returns buildings, units, queues, energy, storage. |
| `PATCH /api/planets/:id` | Owning player | Connected; trims and limits name to 40 characters. |
| `GET /api/planets/:planetId/buildings` | Owning player | Connected; settles due completion/production and returns allowlisted field/energy/category metadata, authoritative balances/rates/storage, every ordered prerequisite, per-building field and energy projections/eligibility, and public active-construction data without queue job IDs. Availability priority is active construction, prerequisites, fields, energy, then resources. |
| `POST /api/planets/:planetId/buildings` | Owning player | Connected; after due completion and under a planet lock, recomputes authoritative completed levels, rejects missing prerequisites, blocks projected field use above persisted capacity with `PLANET_FIELDS_FULL`, and then blocks demand-increasing upgrades above energy supply—all before resource settlement/deduction/row creation/scheduling. It then enforces resources and atomically snapshots accepted cost. |
| `DELETE /api/planets/:planetId/buildings/:queueItemId` | Owning player | Connected; serializes against completion, atomically cancels and refunds 50% of the stored accepted cost, then removes Redis work best-effort. |
| `GET /api/research?planetId=...` | Owning player | Connected read-only catalogue; settles the selected planet's due building/resources, returns allowlisted account levels, local lab/resources, deterministic technology entries, and an identifier-free active-work summary. |
| `POST /api/research` | Player owning funding planet | Connected; checks one active research, requirements/resources, deducts, records, schedules. |
| `GET /api/planets/:planetId/shipyard` | Owning player | Connected; catalog, counts, pending batches. |
| `POST /api/planets/:planetId/shipyard` | Owning player | Connected; requirements/resources, batch record, first-unit job. Multiple batches are unintentionally parallel. |
| `GET /api/fleet` | Authenticated player | Deliberately unavailable: returns `503 FLEET_MISSIONS_UNAVAILABLE` without reading or exposing mission data. |
| `POST /api/fleet` | Authenticated player | Deliberately unavailable: returns `503 FLEET_MISSIONS_UNAVAILABLE` without mutating mission, inventory, resources, or jobs. |
| `POST /api/fleet/:id/recall` | Authenticated player | Deliberately unavailable: returns `503 FLEET_MISSIONS_UNAVAILABLE` without mutating mission, inventory, resources, or jobs. |
| `GET /api/fleet/deployments?originPlanetId=...` | Owning player | Connected API-only owned-planet DEPLOY command summary; synchronises the origin, lists only same-account destinations and settles a due canonical outbound deploy before returning an allowlisted active deployment. The player Fleet screen remains unavailable. |
| `POST /api/fleet/deployments` | Owning player + CSRF header | Connected API-only owned-planet DEPLOY launch; accepts only origin/destination IDs, speed and ship manifest, then returns an allowlisted accepted deployment without Redis/BullMQ state. The player Fleet screen remains unavailable. |
| `GET /api/fleet/strikes?originPlanetId=...` | Owning player | Connected allowlisted Corvette-strike command summary. It settles due canonical strike state before returning only origin coordinates, current Heliox, available Corvettes, and safe active target coordinates/phase/timing. |
| `POST /api/fleet/strikes` | Owning player + CSRF header | Connected coordinate-only Corvette-strike launch. It accepts only origin ID, bounded target coordinates and Corvette quantity, returns a safe active projection, and never exposes target IDs, fuel/timing snapshots, resolver data, queue state, or scheduling results. |
| `GET /api/fleet/espionage?originPlanetId=...` | Owning player | Connected allowlisted Probe command summary. It settles a due canonical Probe lifecycle before returning only selected-origin coordinates, Heliox, available Probes, completed Espionage Technology, and safe active phase/timing/report-readiness state. Galaxy remains the target-discovery source. |
| `POST /api/fleet/espionage` | Owning player + CSRF header | Connected coordinate-only Probe launch. It accepts only origin ID and bounded target coordinates, returns a safe active-mission projection, and does not expose target IDs, report data, fuel/timing snapshots or Redis state. |
| `GET /api/espionage/reports` | Attacker only | Read-only, bounded paginated canonical Probe report index. It derives safe target presentation only from each immutable disclosure snapshot and never reads legacy raw reports or live target state. |
| `GET /api/espionage/reports/:reportId` | Attacker only | Read-only canonical Probe report detail. Missing and non-owned reports share the same not-found outcome; the result includes only the persisted disclosure-tier projection. |
| `GET /api/combat/strikes/reports` | Attacker only | Read-only bounded canonical Corvette-strike report index. It projects only immutable safe target identity, outcome, and concise result counts from the persisted report snapshot. |
| `GET /api/combat/strikes/reports/:reportId` | Attacker only | Read-only canonical Corvette-strike report detail. Missing and non-owned reports share one not-found outcome; it exposes only immutable safe combat counts and rounds. |
| `GET /api/reports/combat`, `GET /api/reports/espionage` | Player | Deliberately unavailable legacy raw-report routes (`503 REPORTS_UNAVAILABLE`); canonical Probe and Corvette-strike reads use `/api/espionage/reports` and `/api/combat/strikes/reports`. |
| `/game/galaxy` → `/game/planets/:planetId/fleet?mode=espionage` | Player | Public Galaxy slots offer only a coordinate-only Send Probe handoff. Fleet’s Espionage mode uses the existing selected origin and allowlisted command API; it exposes no target IDs, report payload, scheduler state, or client-derived mission values. |
| `/game/galaxy` → `/game/planets/:planetId/fleet?mode=strike` | Player | Public unprotected same-galaxy slots offer only a coordinate-only Launch Strike handoff. Fleet’s Strike mode submits the selected origin, coordinates, and a presentation-bounded Corvette quantity; it exposes no combat odds, target state, fuel, timing, resolver, or queue data. |
| `GET /api/gates` | Player | Connected; owned fragments and gates. |
| `POST /api/gates/activate` | Owning player | Connected; prerequisites, consumes first three account fragments, creates visible gate. |
| `POST /api/gates/link` | Owner of both planets | Connected; symmetrically links two gates and clears prior partners. |
| `GET /api/galaxy/:galaxy/:system` | Active player | Read-only allowlisted Galaxy projection. Canonical decimal coordinates are bounded to 1–6 galaxies and 1–400 systems; it returns only 12 ordered empty/public/unavailable slots, never target or account IDs. |
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

`apps/api/prisma/schema.prisma` defines PostgreSQL as the only durable game database. The migrations are ordered as the initial schema, `GATE_TRAVEL`, the building accepted-cost snapshot used for deterministic cancellation refunds, then positive required `Planet.fieldCapacity` with a defensive existing-data backfill.

| Model | Purpose and relationships |
| --- | --- |
| `User` | Unique email/username, bcrypt hash, role/status, verification/protection/activity timestamps. One-to-many planets, sessions, verification tokens, sent/received messages, notifications, audit logs, security events, and fragments; optional alliance membership. |
| `Session` | SHA-256 digest of a random bearer cookie, user FK with cascade, 14-day expiry, IP/user-agent. Valid pre-checkpoint plaintext sessions are upgraded on use; there is no cleanup/list/revocation UI. |
| `VerificationToken` | Unique token storage for email verification or password reset; new email-verification tokens are SHA-256 digests with one-time expiry/use state and legacy compatibility, while password-reset tokens retain the earlier plaintext implementation. |
| `Planet` | Owner FK, unique galaxy/system/slot, environment, positive required field capacity (default 180), floating-point resources and production timestamp. Owns buildings/queues/units/missions/debris/fragments/gate. Completed/reserved field use is derived rather than persisted. |
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

Definitions live in `packages/shared/src/constants.ts`; pure calculations live in `packages/shared/src/formulas.ts`, with the building prerequisite graph and evaluator in `packages/shared/src/buildingPrerequisites.ts`.

### Economy and time

- Starting resources: 500 Alloy, 300 Heliox, 0 Aether (`STARTING_RESOURCES`, `constants.ts:419`). Registration also creates Alloy Mine 0, Heliox Extractor 0, and Solar Array 1 (`auth.ts:49`, `auth.ts:92`).
- Building/research costs: each component is `round(baseCost * growth^(targetLevel-1))` (`scaledCost`, `formulas.ts:15`).
- Building time: `max(round(((alloy + heliox) / (2500 * (1 + researchLabLevel)) / economySpeed) * 3600), 15)` seconds (`buildingDurationSeconds`, `formulas.ts:40`). A research lab, rather than a dedicated construction building, accelerates construction.
- Research time: `max(round(((alloy + heliox + 2*aether) / (1000 * (1 + labLevel)) / researchSpeed) * 3600), 30)` seconds (`researchDurationSeconds`, `formulas.ts:53`).
- Shipyard time per unit: `max(round(baseSeconds / max(1, log2(shipyardLevel+2)) / economySpeed), 10)` (`shipyardDurationSeconds`, `formulas.ts:63`).
- Hourly production: 30/20/3 base rate for Alloy/Heliox/Aether, multiplied by `level * 1.1^level * planetTypeMultiplier * economySpeed * researchBonus` (`hourlyProduction`, `formulas.ts:79`). The caller always uses the default research bonus 1, so economy research descriptions do not affect output.
- Storage: `round(10000 * 1.5^storageLevel)` (`storageCapacity`, `formulas.ts`). Production is capped; a storage-building completion settles the old-cap and new-cap time segments separately. Delivery, loot, and refund cap policy is not generalized yet.
- Energy: base supply is 20. Solar output is `20 * level * 1.1^level * (0.5 + solarIndex)`; other configured building energy is linear by level. `available = supply - demand`, utilisation is `100 * demand / supply`, and legacy-deficit production efficiency is `min(1, supply / demand)`. An upgrade that adds continuous demand is accepted when `projectedDemand <= projectedSupply`; generator and zero-demand upgrades are not blocked by an existing deficit. `calculatePlanetEnergy` and `projectBuildingEnergy` are the only shared calculation source.
- Building categories are central constants: Resources contains Alloy Mine, Heliox Extractor, Aether Synthesizer, Alloy Depot, Heliox Tank and Aether Vault; Energy contains Solar Array; Infrastructure contains Shipyard, Research Lab and Gate Observatory.
- Building prerequisites are a separate shared building-only graph. The three mines/extractors and Solar Array are immediate; storage buildings each require their matching producer at level 2; Research Lab requires Aether Synthesizer 1 and Solar Array 2; Shipyard requires Alloy Mine 2, Heliox Extractor 1 and Solar Array 2; Gate Observatory requires Research Lab 3, Aether Synthesizer 2 and Solar Array 4. Only persisted completed levels count, equality satisfies a requirement, and existing buildings remain locked from further upgrades when their current prerequisites are not met.
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

The trusted resource/building slice is authoritative under concurrency and failure: planet-row locking serializes energy-check/settle/spend, rejected energy attempts perform no writes, one active building prevents mixed-queue ambiguity, persisted costs drive refunds, completion claims and all side effects share a transaction, and PostgreSQL repairs missing BullMQ building jobs. The following limitations remain in systems outside that slice:

- Research, shipyard, and fleet spend paths still perform “read/check, then unconditional decrement” patterns that can race; the building path no longer does.
- Fleet ship counts are checked before a transaction and then decremented without a `count >= requested` predicate (`fleet.ts:63-69`, `fleet.ts:130-137`).
- Redis is published on host port 6379 with no authentication in Compose. Anyone who can reach it can manipulate trusted job payloads such as research `userId` and shipyard `perUnitSeconds`.
- Research, shipyard, and fleet processors do not consistently claim a pending row before side effects. Building completion now does.
- Worker payloads carry values that should be derived from PostgreSQL/definitions: research `userId` and shipyard `perUnitSeconds` (`researchProcessor.ts:15`, `shipyardProcessor.ts:32`).
- New-player protection is cosmetic: the fleet route does not enforce `protectedUntil` for attack/raid.
- Mission-specific validation is incomplete: DEPLOY can transfer ships to someone else's planet, self-attacks are allowed, and ESPIONAGE/RECYCLE/EXPLORE do not require the intended vessel.

Server-calculated, exploit-resistant, and retry-safe are accurate for the checkpointed registration/resource/single-building/admin slice, but not for the wider prototype.

## Background jobs, queues, and timed-event handling

`apps/api/src/lib/redis.ts` creates five BullMQ queues:

| Queue | Created by | Worker effect |
| --- | --- | --- |
| `build-queue` | Building route and reconciler | Uses persisted timing/state to atomically complete exactly once, settle split production, update the level, and notify. |
| `research-queue` | Research route | Upserts account research using job `userId`, completes row, notifies. |
| `shipyard-queue` | Shipyard route, processor and reconciler | Completes the persisted accepted batch once at its persisted due time, creates one notification, and restores missing deterministic wake-ups. |
| `fleet-queue` | Legacy prototype only | Queued legacy jobs are preserved but deliberately have no registered worker consumer pending the trusted deploy lifecycle. |
| `deploy-arrival-queue` | Internal Stage 8B2f launch, worker and reconciler | A deterministic wake-up is dispatched after canonical launch commits. Startup/30-second reconciliation scans up to 100 canonical outbound rows, completes overdue arrivals directly, and restores missing future jobs from persisted arrival time. The worker reads only mission ID and calls the PostgreSQL-authoritative completion service. |
| `colonization-arrival-queue` | Internal Stage 9B5a–9B5c launch, worker and reconciler | A deterministic canonical-colonisation wake-up is dispatched after launch commits. Startup/30-second reconciliation scans up to 100 canonical outbound rows, completes overdue arrivals directly, and restores missing future jobs from persisted arrival time. The worker accepts only a mission ID and calls the shared PostgreSQL-authoritative completion transaction. |

Building creation first commits PostgreSQL state and then best-effort enqueues a deterministic Redis job. The worker scans all pending building rows at startup and every 30 seconds, preserves live jobs, replaces failed/missing jobs, and writes the deterministic ID back. Research, shipyard, and fleet flows do not yet have equivalent reconciliation or an outbox.

Redis has a named volume and snapshot rule `--save 60 1`. Building correctness no longer depends on that snapshot because PostgreSQL queue timestamps/status are the recovery source; other queues can still diverge after Redis loss or a cross-store failure.

Processor-specific hazards:

- Building completion locks planet then construction, conditionally claims `PENDING`, and commits production, level, status, and one notification together. Research retains the earlier non-claiming behavior.
- Shipyard commits the unit increment before scheduling/updating the next unit. A failure in between causes a retry to add the same unit again.
- Legacy fleet arrival/return code retains its original unsafe behavior but is deliberately dormant: no worker registers a `fleet-queue` consumer. The separate `deploy-arrival-queue` accepts only canonical owned-planet DEPLOY wake-ups.
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
| `worker` | Internal configurable health port | Waits for API and infrastructure; starts build, research, Shipyard, and internal deploy-arrival workers plus building/research/Shipyard/deploy-arrival reconciliation; readiness checks PostgreSQL/Redis. |
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
| `BIND_ADDRESS`, `*_HOST_PORT` | Local Compose/launcher | Loopback-only host bindings; the launcher selects bounded fallbacks without changing container-side service ports. |
| `NODE_ENV` | API/container | Controls Prisma singleton and cookie default; local Compose and the launcher use development mode. |
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
| Root guard/source tests, 33 tests | Database URL/reset safety, local-launcher port selection/command scope/redaction, vertical-slice project/database/cleanup/redaction safety, and the read-only admin-page source boundary. | General browser/component/accessibility testing. |
| Shared, 61 tests | Existing formulas plus deterministic timestamp production, precision, validation, central current/projected energy and fields, hard-gate edge cases, category mapping, ordered building-only prerequisites, visual projection/storage timing, capacity-aware next-action selection and planet-switch routing. | Broader combat/research/shipyard/fleet formula edge cases. |
| API config/failure boundaries, 22 tests | Runtime parsing, production restrictions, normalized failures/log redaction, liveness and readiness. | Proxy behavior and authenticated SMTP. |
| API integration, 136 tests | Existing routes plus atomic registration, email recovery, session hardening, prerequisite/field/energy-gated resource and building concurrency/completion, overdue settlement, structured lock details, command-summary consistency/ownership/allowlisting, and admin player-state RBAC/allowlists/audit. | Research/shipyard/fleet/social concurrency and complete authorization matrices. |
| Worker config/health, 16 tests | Runtime parsing and separate liveness/readiness behavior. | Operational telemetry beyond probes. |
| Worker integration, 27 tests | Existing fleet cases plus building transition timing, idempotency, race behavior and reconciliation. | Research/shipyard/fleet general idempotency and recovery. |
| Full stack | Volume-preserving local launcher, project-scoped reset/test runner, and one disposable scenario | The local launcher handles conflicts and phased dependency readiness. The reset runner invokes every supported verification layer. The disposable scenario covers registration → Mailpit verification → login/session digest → command snapshot → locked prerequisite rejection without side effects → homeworld → global building state/completion → production → logout/login → full restart → admin inspection/audit, with cleanup and unrelated-container checks. |

The root `npm test` runs 295 unit/integration tests. API/worker integration suites fail closed unless an explicitly opted-in `TEST_DATABASE_URL` passes the test-database guard; they never fall back to runtime `DATABASE_URL`. Build verification remains the separate `npm run build` command. `npm run start:local` provides conflict-aware, volume-preserving local startup; `npm run test:reset` composes the explicitly destructive clean reset, Prisma Client generation, isolated migrations, tests, build, disposable full-stack restart check, and final development startup. Both commands are scoped to the Eon Rover Compose project. The known ESLint 9 configuration failures remain outside this milestone.

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
