# Research system audit

Stage 6A establishes a read-only, authoritative catalogue. It does not make the
prototype research queue safe to schedule, cancel, or complete. Persisted levels
are account-wide; the selected owned planet supplies its Research Lab level and
the presentation-only resource affordability check.

## Catalogue and audit

| Persisted id | Display name | Category | Scope | Formula and requirements | Advertised effect | Status and consumers | Audit finding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `alloyProcessing` | Alloy Processing | Economy | Account | `round(base × 1.6^(next-1))`; Lab 1 | Alloy Mine yield | PLANNED; no consumer | Production always uses modifier 1. |
| `helioxCombustion` | Heliox Combustion | Economy | Account | `round(base × 1.6^(next-1))`; Lab 1 | Heliox yield and fuel efficiency | PLANNED; no consumer | Neither production nor fleet fuel reads it. |
| `aetherPhysics` | Aether Physics | Science | Account | `round(base × 1.7^(next-1))`; Lab 4, Aether Synthesizer 1 | Aether yield; advanced research | PARTIAL; Gate Theory prerequisite | Aether-yield claim is disconnected. |
| `propulsionTheory` | Propulsion Theory | Propulsion | Account | `round(base × 1.6^(next-1))`; Lab 2 | Fleet cruise speed | PLANNED; no consumer | Fleet travel does not read it. |
| `espionageTech` | Espionage Technology | Intelligence | Account | `round(base × 1.6^(next-1))`; Lab 3 | Espionage and counter-intel accuracy | ACTIVE; fleet processor | Used for attacker/defender espionage comparison. |
| `shieldTech` | Shield Technology | Combat | Account | `round(base × 1.7^(next-1))`; Lab 4 | Ship/defence shield strength | ACTIVE; fleet processor | `techBonus` is used in combat resolution. |
| `weaponTech` | Weapon Technology | Combat | Account | `round(base × 1.7^(next-1))`; Lab 4 | Ship/defence weapon damage | ACTIVE; fleet processor | `techBonus` is used in combat resolution. |
| `armourTech` | Armour Technology | Combat | Account | `round(base × 1.7^(next-1))`; Lab 4 | Ship/defence hull integrity | ACTIVE; fleet processor | `techBonus` is used in combat resolution. |
| `gateTheory` | Gate Theory | Eon Gates | Account | `round(base × 1.8^(next-1))`; Aether Physics 3, Gate Observatory 1 | Gate activation and fragment analysis | PARTIAL; gate route | Gate activation checks it; fragment-analysis promise is incomplete. |

The Research Lab is planet-local. It affects duration only for the selected
funding/laboratory planet; completed technology levels remain account-wide.

## Canonical rules

`packages/shared/src/researchCatalogue.ts` is the sole catalogue for the nine
persisted identifiers. It supplies deterministic category/order metadata,
costs, duration, typed requirements, and effect honesty. Cost is rounded at
each resource component. Duration is `max(round(((alloy + heliox + 2×aether) /
(1000×(1+labLevel)) / researchSpeed)×3600), 30)` seconds. Invalid levels are
treated as zero and invalid/non-positive speeds use the existing 0.01 minimum,
so presentation cannot emit non-finite values.

The player interface remains read-only and labelled “Coming later”, but accepted
queue work now snapshots cost, duration and `completesAt`; later configuration
changes never move that persisted deadline.

## Formula conflicts found

There was one formula source in `formulas.ts` and a separate untyped definition
map in `constants.ts`; neither encoded category, scope, effect connection, or
deterministic order. The catalogue now owns the definitions and uses the same
existing rounded cost and duration formula. No valid balance value was changed.

## Next implementation boundaries

## Stage 6B transaction contract

Research start and cancellation lock rows in this order: account, originating
planet, completed research records, then queue row. A partial unique index on
pending queue rows by account is the final database guard against concurrent
starts from separate planets. Each queue row snapshots the accepted three-part
cost and duration; cancellation refunds `Math.round(snapshot × 0.5)` to the
originating planet only. Redis is scheduled or removed after the database
commit, so a Redis failure leaves the committed PostgreSQL state intact.

Only ACTIVE and accurately-described PARTIAL catalogue effects are eligible.
PLANNED entries reject with `RESEARCH_EFFECT_UNAVAILABLE` without spending
resources. No player scheduling controls are enabled here.

### Stage 6B

- atomic research start;
- transaction-safe resource deduction;
- one account-wide active research item;
- requirement enforcement;
- cost and duration snapshots;
- safe cancellation and refund;
- post-commit BullMQ scheduling.

### Stage 6C

`completeResearch` is one PostgreSQL-authoritative serializable transaction
shared by API fallback, worker and reconciliation. It locks account →
originating planet → queue row, rechecks the persisted deadline, only raises a
level when below the accepted target, then marks the row complete and creates
the single notification atomically. Duplicate, missing and cancelled deliveries
are safe no-ops.

Cancellation before `completesAt` wins and refunds once; at or after that
instant completion wins, so completed work cannot refund. Already accepted work
for a suspended account may still complete. An early BullMQ delivery moves its
current deterministic job back to the persisted deadline; payload owner, level,
status and time are ignored.

The research-only reconciler runs at worker startup and every 30 seconds. Its
process-local non-overlap guard examines one stable ordered batch of at most
100 pending rows, completes overdue rows directly, and restores missing or
terminal future jobs as `research-<queue-id>`. PostgreSQL remains authoritative,
so no distributed Redis lock is needed. Owned catalogue reads and a subsequent
research start settle the caller's due work first.

No production boundary split is needed yet because no ACTIVE or PARTIAL effect
changes lazy production. Future economy effects have an extension point in the
authoritative completion transaction before a production modifier changes.

### Stage 6D

- final interactive research interface;
- shell integration;
- countdown refresh;
- complete vertical-slice coverage.
