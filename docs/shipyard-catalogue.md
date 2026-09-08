# Shipyard catalogue audit (Stage 7A)

Stage 7A centralises the seven persisted `Ship.key` values in `packages/shared/src/shipyardCatalogue.ts`: Scout, Probe, Transporter, Colony Ship, Corvette, Frigate and Recycler. Their original display names, descriptions, base costs, build times, statistics and prerequisites remain in the existing shared `SHIPS` definitions; the catalogue adds stable categories, mission descriptions and truthful effect labels.

The per-unit duration remains `baseSeconds / max(1, log2(shipyardLevel + 2)) / economySpeed`, with a ten-second floor. Invalid, non-finite or non-positive speed inputs are rejected. No values or starter state were rebalanced.

Fleet movement currently accepts any known ship for most mission types. Transport cargo, Colony Ship colonisation and combat statistics are active. Espionage reports and debris recovery work, but the server does not require a Probe or Recycler respectively; these are labelled PARTIAL. Scout-only exploration is not enforced and is also PARTIAL.

The legacy `ShipyardQueueItem` worker increments ships/defences one unit at a time without the later PostgreSQL-authoritative claim/reconciliation protections. Stage 7A presents pending, completed and cancelled legacy rows through a safe read-only summary and removes the Shipyard construction POST endpoint. Stage 7B is atomic construction start/cancellation; Stage 7C is completion/reconciliation; Stage 7D is the complete player-facing scheduling workflow.
