-- Extend only the canonical defence marker allowlist. Existing defence rows
-- remain null-marked and are never reclassified or backfilled.
ALTER TABLE "ShipyardQueueItem"
  DROP CONSTRAINT "ShipyardQueueItem_canonicalDefence_check";

ALTER TABLE "ShipyardQueueItem"
  ADD CONSTRAINT "ShipyardQueueItem_canonicalDefence_check"
  CHECK (
    "canonicalDefenceKey" IS NULL
    OR (
      "canonicalDefenceKey" IN ('flakTurret', 'railBattery', 'planetaryShield')
      AND "itemType" = 'defence'
      AND "itemKey" = "canonicalDefenceKey"
    )
  );
