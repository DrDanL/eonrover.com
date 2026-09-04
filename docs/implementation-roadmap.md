# Eon Rover implementation roadmap

## Roadmap principles

The repository already contains a broad prototype. The fastest route to a playable game is not adding another system; it is making the narrow existing loop trustworthy:

1. register and sign in securely;
2. receive exactly one persisted first planet;
3. accrue resources by server timestamp;
4. buy one building upgrade;
5. complete that upgrade on a server-authoritative timer;
6. survive logout and service/container restart;
7. expose a protected read-only administrator view.

PostgreSQL should be the source of truth for game/workflow state. BullMQ can remain as the existing timer/wake-up mechanism, but correctness must not depend on one Redis job surviving. No additional service is justified for the initial slice.

Each stage below is intentionally narrow, ordered, and independently testable. Advanced systems should remain feature-frozen until Stage 6 passes.

## Stage 0 — make verification safe and repeatable

**Objective:** Prevent automated tests from ever cleaning a normal database, document a dedicated test database contract, and establish a reliable baseline command set.

**Why this comes next:** The current API and worker test setup deletes all rows behind any `DATABASE_URL`. It is unsafe to use those suites to validate subsequent work until isolation is explicit.

**Existing files likely affected:**

- `apps/api/src/testSetup.ts`
- `apps/worker/src/testSetup.ts`
- `apps/api/jest.config.js`
- `apps/worker/jest.config.js`
- `.env.example`
- `package.json`
- `README.md`

**New components that may be required:**

- A shared test-database guard/helper, or duplicated small guards in API and worker.
- A Compose test profile/database only if a dedicated database cannot be created simply in the existing PostgreSQL service.

**Dependencies on earlier stages:** None.

**Acceptance criteria:**

- API/worker integration tests refuse to run destructive setup unless an explicit test-only opt-in is set and the parsed database name meets an agreed test naming rule.
- Missing test configuration fails clearly or skips clearly; it cannot produce a misleading all-green integration result.
- A documented command creates/migrates/tests an isolated database without touching normal development data.
- Existing shared tests still pass; existing integration tests pass against the isolated database.

**Recommended tests:** Unit-test URL/guard parsing; run integration suites against a disposable named database; prove a normal development URL is rejected before any delete.

**Decision before implementation:** Choose the convention: `TEST_DATABASE_URL` plus an explicit `ALLOW_TEST_DATABASE_RESET=1` is recommended. Decide whether CI will create a separate database or a temporary PostgreSQL container.

## Stage 1 — establish runtime and failure boundaries

**Objective:** Validate required environment at startup and return/log consistent JSON errors without changing game features.

**Why this comes next:** Registration and queue work currently fail unpredictably on Prisma uniqueness, Redis, or SMTP problems; dependable tests and operations need clear boundaries.

**Existing files likely affected:**

- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/api/src/lib/redis.ts`
- `apps/api/src/lib/mailer.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/redis.ts`
- `docker-compose.yml`
- `.env.example`

**New components that may be required:**

- `apps/api/src/config.ts` and `apps/worker/src/config.ts` for parsed environment.
- Async-route/error middleware and structured error types.
- Readiness checks distinct from liveness checks.

**Dependencies on earlier stages:** Stage 0.

**Acceptance criteria:**

- Invalid/missing production configuration stops startup with a non-secret error.
- Expected conflicts/not-found/validation failures return consistent JSON; unexpected failures return 500 without leaking internals.
- API readiness includes PostgreSQL and Redis where queue actions are promised; worker readiness reflects Redis/PostgreSQL connectivity.
- Compose honors documented Redis/SMTP/health-port settings or the documentation explicitly limits the file to local development.

**Recommended tests:** Config parser unit tests; route test for simulated Prisma conflict; readiness tests with each dependency unavailable; log redaction test.

**Decisions before implementation:** Decide whether `docker-compose.yml` is local-only (recommended) or must be a production template. Decide on a small structured logger; a new logging service is not needed.

## Stage 2 — make registration, verification, login, and first-planet provisioning atomic

**Objective:** Deliver one secure account and exactly one homeworld with a recoverable verification path.

**Why this comes next:** It fulfills the first two vertical-slice outcomes and removes partial-user/orphan-account states before economy work depends on them.

**Existing files likely affected:**

- `apps/api/src/routes/auth.ts`
- `apps/api/src/lib/auth.ts`
- `apps/api/src/lib/mailer.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/*`
- `apps/web/src/app/(public)/register/page.tsx`
- `apps/web/src/app/(public)/verify-email/page.tsx`
- `apps/web/src/app/(public)/login/page.tsx`
- `apps/api/src/routes/auth.test.ts`

**New components that may be required:**

- A transaction-scoped account-provisioning service.
- Verification resend endpoint/page action.
- Normalized email/username fields or a documented canonicalization policy.
- Hashed verification/reset token support.

**Dependencies on earlier stages:** Stages 0–1.

**Acceptance criteria:**

- Registration produces all-or-nothing user, homeworld, starter buildings, and verification-token state.
- Concurrent registrations cannot create duplicate identities or fail with an unhandled slot collision.
- Email/username lookup behavior is documented and consistent for registration/login.
- Verification can be resent without account enumeration or unlimited spam.
- Login, logout, reset, suspension, and session revocation continue to work.
- First-planet protection uses the current configured value, not the compiled default.

**Recommended tests:** Transaction rollback on planet/token failure; concurrent duplicate email/username and slot collision; resend throttling; hashed token expiry/use; session cookie flags by environment; suspended/banned/pending login cases.

**Decisions before implementation:** Decide whether the homeworld is created at registration, verification, or first login. Creating it on successful verification avoids reserving galaxy slots for abandoned accounts; retaining current registration-time creation gives immediate deterministic provisioning. Decide case-insensitive identity rules and whether email delivery is required before returning success.

## Stage 3 — make timestamp-based production authoritative

**Objective:** Correctly accrue and persist Alloy/Heliox/Aether over elapsed server time, including storage, energy, and building-level transitions.

**Why this comes next:** Every purchase depends on a trustworthy resource balance. The current lazy approach is appropriately simple but must be atomic and time-segmented.

**Existing files likely affected:**

- `packages/shared/src/formulas.ts`
- `packages/shared/src/formulas.test.ts`
- `apps/api/src/services/planetService.ts`
- `apps/api/src/services/gameConfig.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/routes/planets.ts`
- `apps/web/src/app/(game)/game/planets/[planetId]/page.tsx`
- `apps/web/src/components/ResourceBar.tsx`

**New components that may be required:**

- A transaction-scoped `settlePlanet(at)` domain function used by both reads and writes.
- Optional optimistic version or database row-lock helper.
- A production-rate response contract.

**Dependencies on earlier stages:** Stages 0–2.

**Acceptance criteria:**

- The server is the only writer of elapsed production totals and timestamps.
- Two concurrent settle/spend actions cannot double-accrue, lose accrual, overspend, or make a resource negative.
- Production before and after a building/energy/storage change uses the correct level for each time segment.
- Storage behavior is specified for deliveries, loot, refunds, and production; no path accidentally bypasses the chosen rule.
- Logout/login and API restarts do not alter the result for the same timestamps.
- The planet response exposes current hourly rates and the UI labels them without calculating authoritative totals in the browser.

**Recommended tests:** Frozen-clock unit/integration cases for 0/negative/long elapsed time, storage cap, insufficient energy, level transition at an exact timestamp, concurrent settle/spend, and restart-equivalent repeated reads.

**Decisions before implementation:** Prefer integer fixed-point resources (for example milli-units) or documented rounding over floating-point balances. Decide whether non-production additions may exceed storage and whether research bonuses belong in the first slice; deferring bonuses is acceptable if descriptions are corrected.

## Stage 4 — deliver one reliable building upgrade and timer

**Objective:** Make Alloy Mine level 0→1 a complete, atomic, recoverable server-timed action before supporting general multi-item construction.

**Why this comes next:** It is the smallest gameplay loop that proves spend, time, persistence, state transition, and notification behavior together.

**Existing files likely affected:**

- `apps/api/src/routes/buildings.ts`
- `apps/api/src/services/planetService.ts`
- `apps/api/src/lib/redis.ts`
- `apps/worker/src/processors/buildProcessor.ts`
- `apps/worker/src/index.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/routes/buildings.test.ts`
- `apps/web/src/app/(game)/game/planets/[planetId]/buildings/page.tsx`

**New components that may be required:**

- A durable queue-item claim/completion service.
- A small startup/periodic reconciler that enqueues missing overdue/future jobs from PostgreSQL.
- Deterministic BullMQ job IDs derived from queue item IDs.
- Completion-status polling or targeted revalidation in the web page.

**Dependencies on earlier stages:** Stage 3, because production must settle at the building completion boundary.

**Acceptance criteria:**

- An affordable Alloy Mine upgrade deducts exactly once and records one pending item with server timestamps.
- Parallel requests cannot enqueue duplicate level transitions or overspend.
- The worker atomically claims and completes the item exactly once; retries cannot double-notify or regress/corrupt levels.
- A missing Redis job is recreated from PostgreSQL, and an overdue item completes after worker restart.
- Cancellation and completion have a single winner with a documented refund; no race can both refund and build.
- The browser cannot choose cost, target level, start time, or completion time.
- The page refreshes/revalidates after completion and displays persisted level 1.

**Recommended tests:** Full Alloy Mine 0→1 integration test with fake clock; duplicate POST; worker double delivery; crash between DB commit and enqueue; cancellation-at-completion race; Redis flush/restart reconciliation; logout/login during timer.

**Decisions before implementation:** For the initial slice, limit each planet to one active building item (recommended). Generalize to an ordered queue only after the single-item invariant passes. Decide refund percentage and whether cancellation is permitted in the last seconds.

## Stage 5 — guarantee persistence across service and container restart

**Objective:** Demonstrate that account, planet, resources, and a pending/overdue building complete correctly across controlled restarts.

**Why this comes next:** Named volumes alone do not prove workflow recovery; this is an explicit vertical-slice requirement.

**Existing files likely affected:**

- `docker-compose.yml`
- `apps/api/Dockerfile`
- `apps/worker/Dockerfile`
- `apps/worker/src/index.ts`
- Queue/reconciliation code from Stage 4
- `README.md`

**New components that may be required:**

- A restart smoke-test script using the isolated environment.
- Graceful shutdown hooks for API Redis/Prisma and worker queue connections.

**Dependencies on earlier stages:** Stage 4.

**Acceptance criteria:**

- After logout/login and API/web restart, the player and planet balances/levels are unchanged except for correct elapsed production.
- A building queued before worker/Redis restart completes once after its PostgreSQL `completesAt`.
- A restart between queue-row commit and BullMQ enqueue is repaired automatically.
- Health/readiness identifies a worker that cannot process timers.
- Backup and restore commands are corrected and tested against a disposable database.

**Recommended tests:** Automated Compose smoke test for graceful worker restart, forced worker termination, Redis restart, API restart, full stack restart, and logical PostgreSQL backup/restore.

**Decisions before implementation:** Decide the promised failure model. PostgreSQL-authoritative reconciliation is recommended; do not promise survival of PostgreSQL loss. Decide whether Redis queue persistence is performance-only or part of the backup contract.

## Stage 6 — finish the protected administration slice and release gate

**Objective:** Provide a basic, trustworthy administrator view for accounts, planets, active building timers, system readiness, and selected audit actions; then prove the whole vertical slice end to end.

**Why this comes next:** A minimal operator view is required before inviting real players and is the final requirement of the initial vertical slice.

**Existing files likely affected:**

- `apps/api/src/routes/admin.ts`
- `apps/api/src/middleware/auth.ts`
- `apps/web/src/app/(admin)/admin/layout.tsx`
- `apps/web/src/app/(admin)/admin/page.tsx`
- `apps/web/src/app/(admin)/admin/users/page.tsx`
- `apps/web/src/app/(admin)/admin/jobs/page.tsx`
- `apps/api/prisma/schema.prisma`

**New components that may be required:**

- Read-only queue-record/status endpoint based on PostgreSQL rather than raw Redis job payloads.
- End-to-end browser test covering player and administrator roles.

**Dependencies on earlier stages:** Stages 0–5.

**Acceptance criteria:**

- Player, moderator, unauthenticated, and admin access are tested at both UI and API boundaries.
- Admin can read users/planets/pending building state and dependency readiness without accessing password hashes or bearer tokens.
- Any admin mutation in slice has accurate success/failure audit semantics; audit history survives subject deletion according to policy.
- Raw job deletion is removed or replaced by a domain-aware cancel/retry/repair action.
- One end-to-end test proves registration → verification → login → first planet → elapsed resources → Alloy Mine upgrade → timed completion → logout/login/restart persistence → admin visibility.

**Recommended tests:** API RBAC matrix; sensitive-field snapshot; failed/successful audit semantics; browser happy path at desktop and narrow viewport; keyboard-only smoke test.

**Decisions before implementation:** Decide whether moderators belong in the first release. If retained, write an explicit permission matrix. Decide retention/redaction policy for security and audit metadata.

## Vertical-slice release checkpoint

Do not proceed to the systems below until all of these are true:

- The Stage 6 end-to-end scenario passes repeatedly against isolated containers.
- Test setup cannot target a normal database.
- Resource and building concurrency tests pass.
- Killing/restarting the worker does not lose or duplicate a building completion.
- The README accurately separates verified local development from any production deployment guidance.
- Known advanced routes are either disabled behind a development flag or visibly labeled experimental so the initial release does not imply safe multiplayer combat/economy behavior.

## Stage 7 — generalize construction, storage, and energy

**Objective:** Extend the proven single-building mechanism to all buildings and a correctly ordered per-planet queue.

**Why this comes next:** It expands the core economy without introducing a new processing pattern.

**Existing files likely affected:** `packages/shared/src/constants.ts`, `packages/shared/src/formulas.ts`, `apps/api/src/routes/buildings.ts`, `apps/worker/src/processors/buildProcessor.ts`, building/planet pages.

**New components that may be required:** Queue ordering/position field and domain-aware cancellation/rescheduling.

**Dependencies on earlier stages:** Vertical-slice checkpoint.

**Acceptance criteria:** Mixed building keys use correct per-key levels/costs; only the queue head can complete; dependency checks have defined queued-level semantics; energy/storage changes settle production at exact boundaries; canceling an item leaves later timestamps correct.

**Recommended tests:** Mixed queue, repeated same key, prerequisite built earlier in queue, middle/head cancellation, storage/energy transitions, worker retries.

**Decision before implementation:** Decide maximum queue length and whether costs are paid at enqueue or start.

## Stage 8 — connect research effects and resilient research timing

**Objective:** Apply the proven workflow pattern to one account-wide research queue and wire each promised technology effect.

**Why this comes next:** Research touches economy, flight, and combat, so its semantics should be fixed before those systems expand.

**Existing files likely affected:** `apps/api/src/routes/research.ts`, `apps/worker/src/processors/researchProcessor.ts`, `apps/api/src/services/requirements.ts`, shared constants/formulas, research UI, Prisma schema.

**New components that may be required:** User relation for `Research`; durable research claim/reconciler; centralized technology-bonus service.

**Dependencies on earlier stages:** Stage 7.

**Acceptance criteria:** One account-wide job is enforced by the database under concurrency; completion derives owner from the queue planet/database rather than Redis payload; retries are idempotent; every description has a tested effect or is rewritten; research timing uses intended lab semantics.

**Recommended tests:** Concurrent starts from two planets, worker replay, owner deletion, each bonus at levels 0/1/high, prerequisite transitions.

**Decision before implementation:** Confirm whether lab level is planet-local and whether completed research applies globally immediately at its timestamp.

## Stage 9 — make shipyard construction a true serial queue

**Objective:** Build ships/defences exactly once through one ordered queue per planet.

**Why this comes next:** Fleets should not be expanded until units cannot be minted by parallel batches or retries.

**Existing files likely affected:** `apps/api/src/routes/shipyard.ts`, `apps/worker/src/processors/shipyardProcessor.ts`, `apps/worker/src/queues.ts`, shipyard UI, Prisma schema.

**New components that may be required:** Queue ordering/next-unit timestamps and domain-aware cancel/refund service.

**Dependencies on earlier stages:** Stage 8 and the Stage 4 durable-job pattern.

**Acceptance criteria:** Multiple orders serialize; each unit is claimed/completed once; replay cannot mint units; item type/key are database constrained or revalidated; restart recovery works; cancellation/refund semantics are visible.

**Recommended tests:** Two batches, large batch, duplicate job, crash after unit increment, cancel head/tail, requirements changing after enqueue.

**Decision before implementation:** Decide whether a batch is atomic, unit-by-unit cancellable, or splittable and how partial refunds work.

## Stage 10 — constrain galaxy navigation and transport/deploy travel

**Objective:** Establish a safe fleet core with bounded coordinates, fleet slots, mission-specific ownership rules, fuel/cargo handling, recall, and return.

**Why this comes next:** Transport/deploy are lower-risk than combat and prove travel state transitions.

**Existing files likely affected:** `apps/api/src/routes/fleet.ts`, `apps/worker/src/processors/fleetProcessor.ts`, `apps/api/src/routes/galaxy.ts`, shared travel/fuel formulas, fleet/galaxy pages, Prisma schema.

**New components that may be required:** Mission state-transition service, atomic asset reservation, deterministic arrival/return job IDs, fleet slot calculation.

**Dependencies on earlier stages:** Stage 9.

**Acceptance criteria:** Concurrent dispatch cannot oversend; coordinate limits are shared; transport/deploy ownership policy is explicit; cargo and fuel are conserved; delivery storage semantics match Stage 3; recall and arrival have one atomic winner; all transitions recover after restart and replay.

**Recommended tests:** Concurrent sends, exact capacity/fuel, external vs own transport/deploy policy, recall at boundary, missing/deleted target, arrival/return replay, storage cap.

**Decisions before implementation:** Decide whether transport to other players is allowed, whether deploy is own-planet only (recommended), whether return fuel is reserved upfront, and how many simultaneous fleets are allowed.

## Stage 11 — exploration, colonisation, and Eon Gates

**Objective:** Add non-combat expansion on top of reliable fleets and make the original Eon Gate mechanic coherent.

**Why this comes next:** These systems depend on fleet recovery, coordinate limits, research, and shipyard integrity but not yet on combat balance.

**Existing files likely affected:** Fleet/gate routes and processor, `packages/shared/src/constants.ts`, Prisma gate/planet models, galaxy/gate/fleet pages.

**New components that may be required:** Exploration outcome/report model, database-enforced planet-count reservation, self-relation for gate links.

**Dependencies on earlier stages:** Stage 10.

**Acceptance criteria:** Explore requires designated ships and produces auditable server outcomes; colonisation atomically enforces capacity/empty slot and conserves escorts/cargo/colony ships; new colonies receive an intentional starter state; gate activation/link/travel is symmetric, constrained, idempotent, and recoverable; public visibility has a defined effect or the field is removed.

**Recommended tests:** Outcome boundaries with injected RNG, concurrent colonisers, max planets, multiple colony ships, cargo settlement, link replacement, dangling gate deletion, gate travel replay.

**Decisions before implementation:** Define colonisation cost/starter package, exploration outcome table and seeded/auditable randomness policy, and what visible gates reveal to rivals.

## Stage 12 — new-player protection, espionage, combat, debris, and recycling

**Objective:** Enable adversarial play only after server invariants and recovery are proven.

**Why this comes next:** These actions can destroy or transfer player value, so they carry the highest fairness and concurrency risk.

**Existing files likely affected:** Fleet route/processor, reports route/pages, shared combat/espionage formulas, user/debris/report models, admin config.

**New components that may be required:** Attack-eligibility policy service, versioned combat report schema, transactional combat resolution, battle RNG/audit strategy.

**Dependencies on earlier stages:** Stage 11.

**Acceptance criteria:** Protection is enforced at launch and re-evaluated under an explicit arrival policy; self/friendly/invalid targets are handled; mission vessels are required; espionage accuracy controls disclosure/detection; combat conserves units/resources and replay is harmless; defender resources are settled; debris formula and concurrent recycling are correct; reports are readable and relationally consistent.

**Recommended tests:** Full eligibility matrix, protection expiry boundary, simultaneous attacks/recyclers, six-round edge cases, draw/loss/win conservation, RNG fixtures, report authorization, job replay/crash recovery.

**Decisions before implementation:** Finalize combat math, shield/hull behavior, debris percentages/materials, loot priority, friendly-fire rules, protection eligibility and break conditions, and randomness reproducibility.

## Stage 13 — alliances, messaging, notifications, and scalable leaderboards

**Objective:** Turn existing basic social screens into moderated, bounded systems after the economy is trustworthy.

**Why this comes next:** These features add retention but are not required to prove the core game loop.

**Existing files likely affected:** Alliance/message/notification/leaderboard routes and pages, relevant Prisma models, admin routes.

**New components that may be required:** Invitations/applications, role permission service, user block/report records, pagination cursors, score snapshot/materialization only if measurements justify it.

**Dependencies on earlier stages:** Stage 12 for meaningful ranking and diplomacy rules.

**Acceptance criteria:** Alliance leadership cannot be orphaned; rank/leave/delete policies are enforced; messaging has rate limits/block/report/moderation and pagination; notifications cover important domain events without duplicates; ranking formula is documented, deterministic, and performant at target scale.

**Recommended tests:** Alliance race/leadership transfer, permission matrix, spam/rate limiting, blocked users, pagination, notification idempotency, leaderboard ties/performance.

**Decisions before implementation:** Open join versus applications; alliance size/permissions; message retention/privacy; initial ranking dimensions and update cadence.

## Stage 14 — production operations, accessibility, and original visual assets

**Objective:** Prepare a verified release without changing core mechanics.

**Why this comes last:** Operational and presentation polish should target stable flows and measured deployment requirements.

**Existing files likely affected:** Dockerfiles, Compose/docs, all web layouts/styles, public legal/support pages, health/logging code.

**New components that may be required:** CI pipeline, production deployment manifest, migration/rollback/runbook, monitoring hooks, asset license/attribution inventory, automated accessibility checks.

**Dependencies on earlier stages:** Stable feature set through Stage 13; production deployment can begin earlier in parallel once Stage 6 is stable.

**Acceptance criteria:** Images are pinned and runtime containers minimize dev dependencies; secrets/services are not publicly exposed by default; TLS/proxy/cookies/CORS/rate-limit IP behavior are verified; backup and restore are rehearsed; migrations have rollback/recovery guidance; WCAG-oriented keyboard/screen-reader/contrast/responsive testing passes; all graphics are original or licensed and inventoried.

**Recommended tests:** CI build/lint/unit/integration/e2e; dependency/container scan; restore drill; rolling migration rehearsal; axe/browser checks; narrow/large viewport and reduced-motion snapshots; load tests for galaxy/leaderboard/messages.

**Decisions before implementation:** Hosting target, expected concurrency/data retention, observability provider/budget, accessibility conformance target, and visual direction. Do not add infrastructure until these concrete requirements demand it.

## Recommended first implementation task

Start with **Stage 0: test-database isolation and vertical-slice regression scaffolding**. Specifically, replace the current “any `DATABASE_URL` permits deletion” check with an explicit `TEST_DATABASE_URL` plus destructive opt-in/name guard, document the disposable database command, and add the first failing integration test that characterizes registration → exactly one homeworld without changing gameplay code. This is small, independently verifiable, removes the largest immediate data-loss risk, and creates the safe harness needed for every subsequent fix.

## Decisions needed from the project owner

The implementation can begin with Stage 0 without product decisions. Before later stages, confirm:

1. Whether the homeworld is allocated at registration, verification, or first login.
2. Case-insensitive/canonical rules for email and username.
3. Fixed-point resource precision and the storage rule for deliveries/refunds/loot.
4. One active building per planet for the vertical slice (recommended) versus a queue immediately.
5. PostgreSQL-authoritative job reconciliation and the exact restart/failure guarantee.
6. Moderator inclusion and the role permission matrix.
7. Coordinate bounds, fleet slots, cross-player transport, and deploy ownership.
8. New-player protection rules and when protection ends.
9. Final combat/debris/loot/randomness rules before adversarial missions are released.
10. Whether current Compose is local-only (recommended) and the eventual deployment target.
