# Local testing

## 1. Purpose and scope

This guide is for running and manually testing Eon Rover on a local development machine. Run all
commands from the repository root unless a step says otherwise.

Eon Rover has three deliberately separate test environments:

1. The **persistent local development environment** is the six-service Docker Compose project
   `eonrovercom`. It is the environment used for browser testing. Normal stops and restarts preserve
   its PostgreSQL, Redis and Mailpit volumes.
2. The **automated integration-test environment** uses an explicitly configured PostgreSQL database
   whose name ends in `_test`. The tests erase rows in that protected test database, so it must never
   be the normal `eonrover` development database.
3. The **disposable full-stack vertical slice** creates its own `eonrover-e2e-*` Compose project,
   loopback ports and volumes. It tests the complete trusted slice, including a restart, and then
   removes only its own disposable resources.

The everyday path is: create `.env` once, run `npm run start:local`, use the URLs printed by the
launcher, and stop with `npm run stop:local`.

## 2. Prerequisites

1. Install the following tools:

   - Docker Desktop, including Docker Engine and Docker Compose v2;
   - Node.js 24 or newer (the repository declares `node >=24`);
   - npm (no exact npm version is pinned; use the npm supplied with a supported Node.js release);
   - Git.

2. Use macOS or Linux, or a Linux shell under WSL. The documented shell commands use POSIX syntax.
   On macOS, the launcher can open an installed Docker Desktop application when its daemon is not
   running. On Linux and WSL, start the Docker daemon yourself before running the launcher.

3. From the repository root, create the local `.env` file without replacing one that already
   exists:

   ```bash
   if [ -e .env ]; then echo '.env already exists; left unchanged.'; else cp .env.example .env; fi
   ```

   The tracked [`.env.example`](../.env.example) contains local-only placeholders. Review the copy
   before use and keep real passwords or other secrets only in the ignored `.env` file. Do not
   commit `.env`.

4. Check the installed tools if startup reports a prerequisite problem:

   ```bash
   node --version
   npm --version
   git --version
   docker --version
   docker compose version
   ```

## 3. Starting Eon Rover

1. Start the complete local environment with one command:

   ```bash
   npm run start:local
   ```

   The first build can take several minutes while Docker downloads base images and installs the
   workspace dependencies. Later starts normally reuse cached layers.

2. Wait for `Eon Rover is ready`. The launcher builds and starts PostgreSQL, Redis, Mailpit, the
   Express API, the BullMQ worker and the Next.js web application. It waits for the infrastructure,
   API, worker and web health checks, verifies the Docker network, and probes the public web page,
   Mailpit and all four liveness/readiness endpoints before declaring success.

3. Copy URLs from the final startup summary. These printed URLs are authoritative for the current
   run. All published ports bind to `127.0.0.1`. If a configured host port is occupied, the launcher
   leaves its owner alone, chooses a predictable port from a bounded fallback range and reports the
   replacement.

   A changed **host** port does not change service-to-service networking. Inside the Compose
   network, the API and worker always connect to PostgreSQL at `postgres:5432` and Redis at
   `redis:6379`.

4. Check the six containers and their health at any time:

   ```bash
   docker compose --project-name eonrovercom --file docker-compose.yml ps
   ```

   The expected state is `running` and `healthy` for `postgres`, `redis`, `mailpit`, `api`, `worker`
   and `web`.

5. Follow the local logs:

   ```bash
   npm run logs:local
   ```

   Press `Ctrl+C` to stop following the output; this does not stop the containers.

6. Stop only Eon Rover while preserving all local data:

   ```bash
   npm run stop:local
   ```

7. Restart it, using the newly printed URLs in case a host port has changed:

   ```bash
   npm run start:local
   ```

Running `start:local` again is also the normal repair path for a partially started Eon Rover stack.
It does not stop unrelated Docker projects and it does not delete Eon Rover volumes.

## 4. Local URLs

The launcher prints each complete URL. The forms below show how those URLs relate to the
application routes; do not substitute the default port if the launcher printed a replacement.

| Purpose | Route or URL form | Expected result |
| --- | --- | --- |
| Public home page | `<printed-web-url>/` | Eon Rover landing page |
| Registration | `<printed-web-url>/register` | Create-account form |
| Login | `<printed-web-url>/login` | Sign-in form |
| Resend verification | `<printed-web-url>/resend-verification` | Verification resend form |
| Player application | `<printed-web-url>/game` | Protected Command Dashboard |
| Administrator portal | `<printed-web-url>/admin` | Protected Admin Dashboard |
| Player-state explorer | `<printed-web-url>/admin/users` | Administrator-only, read-only player search and detail |
| API liveness | `<printed-api-url>/healthz` | HTTP 200 with `{"status":"ok"}` while the process is live |
| API readiness | `<printed-api-url>/readyz` | HTTP 200 only when PostgreSQL and Redis are available |
| Worker liveness | `<printed-worker-url>/healthz` | HTTP 200 with `{"status":"ok"}` while the process is live |
| Worker readiness | `<printed-worker-url>/readyz` | HTTP 200 only when PostgreSQL and Redis are available |
| Mailpit | `<printed-mailpit-url>/` | Captured local email inbox |

The default web, API, worker-health and Mailpit web origins are respectively
`http://127.0.0.1:3000`, `http://127.0.0.1:4000`, `http://127.0.0.1:4100` and
`http://127.0.0.1:8025`. Prefer the complete links in the current startup summary.

## 5. Creating and verifying a player account

1. Open the **Registration** URL printed at startup.
2. Enter a new local username, email address and password, then select **Create account**.

   The current validation rules are:

   - email must be a valid address; surrounding whitespace is removed and the address is stored in
     lower case;
   - username is trimmed, must be 3–20 characters, and may contain only letters, numbers, `-` and
     `_`;
   - password must be 8–128 characters. There is currently no additional composition rule.

   Registration atomically creates the account, exactly one homeworld, its starter resources and
   starter building records. The account cannot sign in until its email is verified.

3. Open the **Mailpit** URL printed at startup. Mailpit captures messages from the local SMTP
   service; it does not deliver them to a real email address.
4. Find the message titled **Verify your Eon Rover account** for the address just registered.
5. Open the message and follow **Verify my email**. A successful page says that verification is
   complete and that the account can now sign in.
6. Open the printed **Login** URL and sign in with the same email and password. Email input is
   trimmed and matched case-insensitively.
7. On the Command Dashboard, confirm there is exactly one planet carrying the **Homeworld** tag.
   A new homeworld starts with 500 Alloy, 300 Heliox and 0 Aether. Its Alloy Mine and Heliox
   Extractor are level 0, while its Solar Array is level 1.

If the first message is missing, the link is expired, or a newer link has replaced it, open the
printed **Resend verification** page. Enter the account email and wait for the newest Mailpit
message. A resend is accepted with the same generic message whether or not it sends mail; this
prevents account discovery. An unverified account can receive a replacement after a 60-second
cool-down. The new link lasts 24 hours and invalidates all older unused verification links.

## 6. Basic player testing checklist

Use a fresh manual account when you want repeatable starting values.

1. Register the account, confirm one Mailpit message arrives, and verify it.
2. Confirm sign-in is refused before verification and succeeds afterwards.
3. Open `/game` from the printed web origin and confirm exactly one homeworld is shown.
4. Confirm the starter balances are 500 Alloy, 300 Heliox and 0 Aether.
5. Open the homeworld, then select **Buildings**. The browser route has the form
   `/game/planets/<planet-id>/buildings`.
6. Before queueing anything, open the same Buildings page in a second tab. In the first tab, queue
   the **Alloy Mine** upgrade to level 1.
7. Confirm the level-1 cost is deducted once. With the default game configuration this is 60 Alloy
   and 15 Heliox, leaving 440 Alloy and 285 Heliox.
8. Immediately return to the already-open second tab and try to queue an upgrade there. The API
   must reject it with **A building upgrade is already in progress on this planet.** A freshly
   reloaded page disables all queue buttons while construction is active.
9. Return to the first tab and follow the server-authoritative **Completes in** countdown. With the
   default economy speed, the first Alloy Mine takes about 108 seconds; configuration changes can
   alter this, so trust the displayed completion time.
10. Refresh after the due time and confirm the queue clears and the Alloy Mine reaches level 1. The
    worker also adds one building-complete notification.
11. Confirm **Hourly output** for Alloy is now greater than zero. New homeworlds have level-zero
    mines, so passive resource production begins only after this first Alloy Mine upgrade.
12. Note the Alloy balance, refresh immediately, and confirm that the elapsed production interval
    has not been added twice. A very small increase caused by real elapsed time is normal.
13. Open `/game/settings`, select **Sign out**, then use Back and refresh a protected `/game` page.
    It should return you to login and the old session must not authenticate.
14. Sign in again and confirm the same homeworld and completed Alloy Mine are present.
15. Preserve the volumes while restarting:

    ```bash
    npm run stop:local
    npm run start:local
    ```

16. Use the URLs from the new summary, sign in if necessary, and confirm that the account,
    homeworld, building level and resource balances remain. Production should continue from its
    persisted server timestamp.

### Energy-aware building checks

The Buildings page derives every value from the server. Its top panel shows supply, demand,
available capacity, utilisation and production efficiency. The Resources, Energy and
Infrastructure tabs contain only implemented buildings and can be moved with Left/Right, Home and
End while focused.

- A demand-increasing upgrade is allowed when projected demand is below or exactly equal to supply.
- It is rejected with `INSUFFICIENT_ENERGY` only when projected demand exceeds supply. The card shows
  the exact shortfall and links to Energy facilities; balances, timestamps and the construction
  queue do not change.
- A Solar Array upgrade remains available during a deficit, even if that single upgrade does not
  fully remove the deficit. A zero-demand facility also remains available when its resources and
  existing prerequisites allow it.
- Existing deficit planets remain valid. Their production efficiency is reduced proportionally,
  and an already accepted construction is never cancelled by a later energy calculation.

All calculations use persisted building levels and the planet solar index. Browser-supplied energy,
cost, level, duration or balance fields are ignored. The fresh homeworld keeps its existing Solar
Array level 1, so Alloy Mine level 1 remains a valid first upgrade without a balance change.

### Authenticated command shell checks

After signing in, the `/game` route selects an owned planet and opens its overview. The resource bar
is shared by authenticated player pages: balances may visibly rise between reads, but they are
projected only from the last server timestamp/rates and stop at the displayed storage capacity.

- Leave a visible page open for a few seconds and confirm a producing resource increases smoothly.
  The browser should not request the command-summary endpoint every second; its normal authoritative
  interval is one minute.
- Hide and restore the tab. The live timer pauses while hidden, then the shell immediately refreshes
  authoritative state when visible again.
- Start or cancel a building and confirm the global construction row refreshes on other player pages.
  Completion is confirmed by the server; an expired browser countdown never completes a row locally.
- If the account has multiple real colonies, switch planets from Overview and Buildings. The
  equivalent section is preserved; switching from an empire-wide page returns to planet overview.
- Research, Shipyard and Fleet are labelled **Coming later** in the shell because their existing
  prototype routes do not yet meet the trusted queue/effect/recovery standard.

### Building prerequisite checks

Building progression is enforced by the API from persisted, completed building levels. A pending
upgrade does not count, browser-supplied levels are ignored, and meeting the exact required level
unlocks the dependent building. The Stage 5C1 progression table is:

| Building | Completed building levels required |
| --- | --- |
| Alloy Mine | None |
| Heliox Extractor | None |
| Aether Synthesizer | None |
| Solar Array | None |
| Alloy Depot | Alloy Mine 2 |
| Heliox Tank | Heliox Extractor 2 |
| Aether Vault | Aether Synthesizer 2 |
| Research Lab | Aether Synthesizer 1; Solar Array 2 |
| Shipyard | Alloy Mine 2; Heliox Extractor 1; Solar Array 2 |
| Gate Observatory | Research Lab 3; Aether Synthesizer 2; Solar Array 4 |

The progression keeps core resource and energy production available immediately. Storage follows
development of its matching resource, advanced infrastructure requires an operating economy and
energy base, and Eon Gate infrastructure is deliberately a later planetary objective.

On a fresh homeworld, confirm that Alloy Mine, Heliox Extractor, Aether Synthesizer and Solar Array
have no prerequisite lock. Storage and Infrastructure cards show every requirement, required level,
current completed level, and explicit **Complete** or **Not met** text. Selecting a prerequisite name
switches to its category, scrolls its building card into view and moves keyboard focus there.

Attempting a locked start returns HTTP 409 with code `PREREQUISITES_NOT_MET` and an ordered
`details.requirements` list containing every unmet building ID/name plus required and current levels.
That rejection must not alter resources, `lastProductionAt`, completed levels, the queue, or Redis
jobs. When several restrictions apply, the displayed/API availability priority is active
construction, prerequisites, planetary fields, energy, then resources. Complete the required buildings and refresh to
confirm the lock disappears; a full volume-preserving restart must derive the same eligibility from
the persisted completed levels.

### Planetary building-field checks

Every new homeworld and colony has a fixed capacity of 180 building fields. Each completed level of
every current building uses one field, including Solar Array, storage and infrastructure levels. A
pending accepted upgrade reserves one additional field. Level-zero records, cancelled work and
completed queue records reserve none: usage is always recalculated from completed `Building.level`
values plus `PENDING` building rows and is never accepted from the browser.

The command shell, overview and Buildings page show completed, reserved, occupied, available and
total fields separately from energy. A full planet keeps every building visible, disables eligible
new starts and displays **No planetary fields available**. Starting the final available field is
valid; starting one more returns HTTP 409:

```json
{
  "error": "No planetary building fields are available.",
  "code": "PLANET_FIELDS_FULL",
  "details": {
    "capacity": 180,
    "completedUsed": 180,
    "reserved": 0,
    "available": 0,
    "requiredForUpgrade": 1
  }
}
```

The locked validation order is active construction, completed-level prerequisites, planetary
fields, projected energy, then settled resource affordability. A field rejection therefore leaves
balances, production time, building levels, PostgreSQL queue rows and BullMQ unchanged. Cancellation
releases its derived reservation on refresh; completion changes the same field from reserved to
completed without double counting it.

For a defensive legacy state whose completed levels exceed capacity, the interface clamps available
fields and progress width safely to zero/100%, reports the over-capacity amount, preserves all
completed buildings and their production, and blocks only new construction. Already accepted work
still completes. The migration normally prevents this for existing data: planets below 180 completed
levels receive 180, while planets already at 180 or more receive their completed use plus 10.

Gate Observatory eligibility currently needs Research Lab 3 + Aether Synthesizer 2 + Solar Array 4,
or 9 completed fields. Building Gate Observatory level 1 would occupy a tenth, leaving 170 fields of
the 180-field default. Stage 5C2 intentionally adds no Terraformer, moon, random capacity, or other
field-expansion mechanic.

## 7. Testing email verification and account recovery

1. **Successful delivery:** register a unique account and check that one verification message
   appears in Mailpit. The registration page reports whether the first email was sent.
2. **Login before verification:** try to sign in before following the link. Expect **Please verify
   your email before signing in** and a link to the resend page.
3. **Successful verification:** follow the newest Mailpit link once. Expect **Email verified. You
   can now sign in.** Login should then succeed.
4. **Reused or invalid link:** open the same verification link again, or open `/verify-email`
   without its query value. Expect a verification failure. A submitted invalid, expired, already
   used or replaced value is reported as **Invalid or expired token**.
5. **Resend:** wait at least 60 seconds after the most recent verification token was created, open
   `/resend-verification`, and submit the unverified account email. Expect **Request accepted** and
   the generic acceptance message. Open the newest message in Mailpit.
6. **Replacement behaviour:** after a successful resend, the previous unused link must fail and
   only the newest link can activate the account. Each new link expires after 24 hours.
7. **Already verified or unknown address:** the resend page still returns the generic accepted
   response, but Mailpit receives no message. This is intentional.
8. **Email-send failure during registration:** the account and homeworld remain valid but pending
   verification. Once Mailpit is healthy again, use resend rather than creating a duplicate account.

Treat verification links as credentials. Inspect them only inside the local Mailpit UI; do not paste
their query values into shared logs, documentation, screenshots or bug reports. The application has
no general email-verification bypass.

## 8. Accessing the administrator portal

The existing development provisioner creates one active, already-verified administrator without a
planet. It is idempotent by email and is disabled when `NODE_ENV=production`.

1. In the ignored root `.env`, replace the placeholder values for all three variables:

   ```dotenv
   ADMIN_EMAIL=<your-local-admin-email>
   ADMIN_USERNAME=<your-local-admin-username>
   ADMIN_PASSWORD=<your-local-admin-password>
   ```

   Values in `.env.example` are placeholders, not credentials to reuse. Do not commit the real
   password. Use a new email address: if that email already belongs to any account, the provisioner
   skips it and does not promote or update the existing account.

2. Run the normal launcher first so the database is migrated and healthy:

   ```bash
   npm run start:local
   ```

   The normal launcher deliberately suppresses account provisioning. Start the API image's existing
   one-off provisioner with the `.env` values as follows:

   ```bash
   docker compose --project-name eonrovercom --file docker-compose.yml run --rm --no-deps api npm run seed
   ```

   This starts a temporary API service on the existing Eon Rover network, runs the same provisioner
   used by the API container startup command, and then removes only that temporary container. It
   does not publish another API port or restart the running stack. Expect either **Created the
   configured development administrator** or an idempotent **already exists** message. If a required
   variable was not loaded, it reports that provisioning was skipped.

3. Open the normal printed `/login` page and sign in with the local administrator email and
   password. Login redirects to `/game`; navigate to the exact portal route
   `<printed-web-url>/admin` or use **Admin** in the player sidebar.
4. Open **Player state**, whose exact route is `<printed-web-url>/admin/users`.
5. Search using at least two characters from a username or email, or an exact player ID. Select
   **Inspect player state** on one result.

The player-state explorer is read-only. It shows the account identity, role, status, verification
state, creation/protection dates, planet/session/notification counts, planet coordinates and
environment, settled resources and hourly production, energy, storage, completed building levels,
and any active construction. It does not expose password hashes, session credentials, verification
tokens or internal job identifiers.

Each explicit opening of player detail creates one existing `PLAYER_STATE_VIEWED` audit event. It
can be seen in the administrator Audit area. Settling timestamp-based resources while reading is
also expected server-authoritative behaviour; the explorer exposes no player mutation controls.

If access fails, interpret the status carefully:

- `401` from an administrator API route means there is no valid signed-in session.
- `403` for a normal player is expected. The `/admin` browser layout shows a permission panel, and
  the underlying `/api/admin/*` request rejects the player.
- A moderator can use the general administration console, but `/admin/users` and its two player
  search/detail API routes require the `ADMIN` role and return `403` to moderators.
- A suspended or banned administrator cannot sign in. If its status changes while a session is
  active, the next protected request returns `403` and revokes that session.
- A stale cookie can refer to a logged-out, expired or otherwise revoked session. Sign out, clear
  the `eonrover_sid` cookie for the printed web/API origins in the browser's site-data controls, and
  sign in again. Never copy the cookie value.
- If `ADMIN_EMAIL`, `ADMIN_USERNAME` or `ADMIN_PASSWORD` is missing, blank or not loaded from the
  root `.env`, provisioning is skipped. Rerun the one-off command after correcting `.env`.

## 9. Automated testing

### Database-independent unit tests

1. Run the safe unit and configuration tests. They do not connect to PostgreSQL or delete
   application data:

   ```bash
   npm run test:unit
   ```

### Protected integration tests

1. Start the persistent local stack, then create a separate test database in its PostgreSQL
   service if it does not already exist:

   ```bash
   npm run start:local
   docker compose --project-name eonrovercom --file docker-compose.yml exec postgres \
     sh -c 'createdb --username "$POSTGRES_USER" eonrover_test'
   ```

   PostgreSQL reports an error if the database already exists; that specific result can be ignored.

2. Find the current published PostgreSQL and Redis ports. This matters when the launcher selected
   fallbacks:

   ```bash
   docker compose --project-name eonrovercom --file docker-compose.yml port postgres 5432
   docker compose --project-name eonrovercom --file docker-compose.yml port redis 6379
   ```

3. In the same shell, set the protected test values. Construct the PostgreSQL value privately from
   the local username/password in `.env`, the published PostgreSQL port above, and the dedicated
   database name `eonrover_test`. Do not paste or commit the completed URL:

   ```bash
   export TEST_DATABASE_URL='<your dedicated local PostgreSQL URL ending in /eonrover_test>'
   export ALLOW_TEST_DATABASE_RESET=1
   export REDIS_URL='redis://127.0.0.1:<published-redis-port>/15'
   ```

   The safety guard requires `TEST_DATABASE_URL`; it never falls back to `DATABASE_URL`.
   `ALLOW_TEST_DATABASE_RESET` must equal exactly `1`, and the decoded database name must end in
   `_test`, be a single unambiguous path segment, and not be an administrative database such as
   `postgres`, `template0`, `template1` or `defaultdb`.

4. Apply the migrations to that test URL, then run both integration suites:

   ```bash
   DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:migrate:deploy --workspace @eonrover/api
   npm run test:integration
   ```

   To run the API and worker suites separately, use `npm run test:integration:api` and
   `npm run test:integration:worker`. These tests may erase rows only in the validated test
   database.

### Repository-wide tests and build

1. With the same protected test exports still present, run all unit and integration tests:

   ```bash
   npm test
   ```

2. Build every workspace independently of the tests:

   ```bash
   npm run build
   ```

### Disposable full-stack vertical slice

1. Run the opt-in full-stack verification:

   ```bash
   ALLOW_DISPOSABLE_E2E=1 npm run test:vertical-slice
   ```

   It creates one unique `eonrover-e2e-*` Compose project with randomly selected loopback ports and
   its own PostgreSQL, Redis and Mailpit volumes. It exercises registration, real Mailpit delivery,
   verification, login/logout, exactly one homeworld, resource settlement, exclusive Alloy Mine
   construction, worker completion, administrator/player access controls and persistence across a
   complete stack restart.

   Its `finally` cleanup removes only that disposable project's containers, network and volumes on
   success or failure. It refuses to run without the exact opt-in or with an unsafe project/database
   identity. It does not delete the persistent `eonrovercom` environment.

## 10. Resetting local development data

Normal `stop:local` and `start:local` commands preserve data. Use the command below only when a
clean Eon Rover development database is intentional.

> **Warning:** the next command permanently deletes the `eonrovercom` PostgreSQL, Redis and Mailpit
> volumes. Local accounts, planets, resources, queues, captured email and all other persisted Eon
> Rover development state will be lost. It cannot be undone.

1. Stop Eon Rover and remove only its explicitly named Compose project and volumes:

   ```bash
   npm run stop:local
   docker compose --project-name eonrovercom --file docker-compose.yml down --volumes --remove-orphans
   ```

2. Start a clean environment:

   ```bash
   npm run start:local
   ```

The project name and Compose file keep the target scoped to this repository. Do not replace this
with a global Docker prune or commands aimed at every running container.

For a deliberate clean reset followed by dependency installation, protected automated tests, a
workspace build, diff validation, the disposable vertical slice and a fresh running development
stack, the repository also provides `npm run test:reset`. Preview that destructive workflow first:

```bash
npm run test:reset -- --dry-run
```

## 11. Troubleshooting

### Docker Desktop is not running

1. Check Docker without changing any containers:

   ```bash
   docker info
   docker compose version
   ```

2. On macOS, rerun `npm run start:local`; it attempts to open an installed Docker Desktop and waits
   for up to 90 seconds. Otherwise start Docker Desktop or the Docker daemon yourself, wait until it
   reports ready, and rerun the launcher.

### A host port is already allocated

1. Read the `Occupied host ports were replaced` lines and the final URL summary. This is normally
   informational: the launcher does not stop the process or container holding the preferred port.
2. Confirm the actual Eon Rover mappings:

   ```bash
   docker compose --project-name eonrovercom --file docker-compose.yml ps
   ```

3. Use the printed replacement URLs for that run. Do not stop unrelated projects merely to reclaim
   a default port.

### PostgreSQL is healthy but the API reports Prisma `P1001`

1. Inspect status and bounded logs first:

   ```bash
   docker compose --project-name eonrovercom --file docker-compose.yml ps
   docker compose --project-name eonrovercom --file docker-compose.yml logs --tail 100 postgres api
   ```

2. If the API container is running, confirm Docker DNS resolves the PostgreSQL service name:

   ```bash
   docker compose --project-name eonrovercom --file docker-compose.yml exec api getent hosts postgres
   ```

3. Do not put the published host fallback port into the containers' `DATABASE_URL`. The internal
   endpoint is always `postgres:5432`. Run `npm run start:local` again; it starts and verifies the
   infrastructure before force-recreating the API on the correct network.

### The API, worker or web container is unhealthy

1. Find the first unhealthy dependency:

   ```bash
   docker compose --project-name eonrovercom --file docker-compose.yml ps
   docker compose --project-name eonrovercom --file docker-compose.yml logs --tail 100 postgres redis mailpit api worker web
   ```

2. Check the API and worker readiness URLs printed by the launcher. A live `/healthz` response with
   a failing `/readyz` response points to PostgreSQL or Redis rather than a dead process.
3. Correct the reported configuration or dependency problem and rerun `npm run start:local`. The
   launcher also prints bounded, redacted diagnostics after a failed start.

### Mailpit has no verification email

1. Confirm Mailpit and the API are healthy, then open the exact printed Mailpit URL rather than the
   default port.
2. Check the registration result. If it says the account was created but email could not be sent,
   do not register again.
3. Wait 60 seconds from the previous token creation and submit the account email at the printed
   `/resend-verification` page.
4. Remember that a verified account, an unknown address or a request inside the cool-down produces
   the same accepted response without sending mail.
5. If necessary, inspect only the relevant service logs:

   ```bash
   docker compose --project-name eonrovercom --file docker-compose.yml logs --tail 100 api mailpit
   ```

### A verification link opens the wrong host or port

1. The API builds links from `WEB_URL`. When using `start:local`, it sets this to the selected web
   origin automatically; use an email generated during the current run.
2. For direct Compose use, make `WEB_URL` in `.env` match the browser-visible web origin. If you
   manually change `API_HOST_PORT`, also make the build-time `NEXT_PUBLIC_API_URL` match the
   browser-visible API origin and rebuild the web image.
3. Restart with `npm run start:local`, request a new verification message after the cool-down, and
   use only the newest link.

### The account remains unverified

1. Confirm the verification page displayed a success message before attempting login.
2. An old, reused, expired or replaced link cannot verify the account. Wait for the resend
   cool-down, request a replacement and open the newest Mailpit message.
3. If login still reports `EMAIL_NOT_VERIFIED`, check the API and Mailpit logs without copying the
   verification query value into any report.

### Administrator login succeeds but the portal returns `403`

1. Confirm you used the account created by the development provisioner, not a normal player with a
   similar email or username. The provisioner never changes an existing account's role.
2. A moderator may enter the general console but receives `403` from the administrator-only player
   explorer. Use an `ADMIN` account for `/admin/users`.
3. Suspended and banned accounts cannot keep a valid protected session. Correct account-state
   issues through the application's existing administration path, not by editing PostgreSQL.
4. If `.env` values were missing or were changed after the one-off provisioner ran, rerun that
   provisioner and read its status line.

### The browser retains an old session cookie

1. Select **Sign out** in `/game/settings` when possible.
2. Clear site data for the exact printed web and API origins, or use a new private-browsing window.
   The relevant cookie is named `eonrover_sid`; never copy or publish its value.
3. Reload `/login` and sign in again.

### Application state persists after a restart

This is expected. `npm run stop:local`, `npm run start:local` and ordinary container recreation all
preserve the named PostgreSQL, Redis and Mailpit volumes. Use the checklist in section 6 to confirm
that persistence is correct.

### Start again with a clean Eon Rover database

1. First check status and logs to rule out a startup or stale-browser problem; deleting data is not
   a repair step.
2. If erasing all local Eon Rover state is genuinely intended, read the warning in section 10, run
   its project-scoped reset command, and then run `npm run start:local`.
