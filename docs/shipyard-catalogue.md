# Shipyard catalogue audit (Stage 7A)

Stage 7A centralises the seven persisted `Ship.key` values in `packages/shared/src/shipyardCatalogue.ts`: Scout, Probe, Transporter, Colony Ship, Corvette, Frigate and Recycler. Their original display names, descriptions, base costs, build times, statistics and prerequisites remain in the existing shared `SHIPS` definitions; the catalogue adds stable categories, mission descriptions and truthful effect labels.

The per-unit duration remains `baseSeconds / max(1, log2(shipyardLevel + 2)) / economySpeed`, with a ten-second floor. Invalid, non-finite or non-positive speed inputs are rejected. No values or starter state were rebalanced.

Fleet movement currently accepts any known ship for most mission types. Transport cargo, Colony Ship colonisation and combat statistics are active. Espionage reports and debris recovery work, but the server does not require a Probe or Recycler respectively; these are labelled PARTIAL. Scout-only exploration is not enforced and is also PARTIAL.

The legacy `ShipyardQueueItem` worker increments ships/defences one unit at a time without the later PostgreSQL-authoritative claim/reconciliation protections. Stage 7A presents pending, completed and cancelled legacy rows through a safe read-only summary.

Stage 7B restores API-only, authoritative Ship batches. A batch is one canonical ship key and an integer quantity from 1 through 100. PostgreSQL stores the accepted total resource costs, quantity, duration, timestamps and terminal status; it enforces one pending batch per planet with a partial unique index. Start and cancellation lock account → planet → queue in serializable transactions. Cancellation refunds exactly 50% of the persisted totals. Redis receives only a post-commit deterministic wake-up named `ship-<queue-item-id>`; a scheduling/removal failure cannot change the committed database state.

Stage 7C makes the accepted batch authoritative through completion: a single shared transaction locks account → planet → queue, checks the persisted due time, increments the persisted quantity exactly once, marks the row complete and creates one completion notification. The API settles overdue rows before reads/new starts; the worker treats BullMQ data as an untrusted wake-up carrying only the queue id. A Shipyard-only, bounded 100-row reconciler runs at startup and every 30 seconds to complete overdue rows and restore missing deterministic future jobs. The player page remains read-only until Stage 7D.
