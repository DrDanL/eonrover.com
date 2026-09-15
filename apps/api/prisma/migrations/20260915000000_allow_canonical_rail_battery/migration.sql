-- Extend only the canonical marker allowlist. Historical defence queue rows
-- remain null-marked and inert; no legacy row is backfilled or reclassified.
ALTER TABLE "ShipyardQueueItem"
  DROP CONSTRAINT "ShipyardQueueItem_canonicalFlak_check";

ALTER TABLE "ShipyardQueueItem"
  ADD CONSTRAINT "ShipyardQueueItem_canonicalDefence_check"
  CHECK (
    "canonicalDefenceKey" IS NULL
    OR (
      "canonicalDefenceKey" IN ('flakTurret', 'railBattery')
      AND "itemType" = 'defence'
      AND "itemKey" = "canonicalDefenceKey"
    )
  );
