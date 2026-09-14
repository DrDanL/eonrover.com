-- Legacy Shipyard rows retain their original permissive itemType/itemKey
-- values.  Only a newly accepted Flak Turret batch receives this marker.
ALTER TABLE "ShipyardQueueItem"
  ADD COLUMN "canonicalDefenceKey" TEXT;

ALTER TABLE "ShipyardQueueItem"
  ADD CONSTRAINT "ShipyardQueueItem_canonicalFlak_check"
  CHECK (
    "canonicalDefenceKey" IS NULL
    OR (
      "canonicalDefenceKey" = 'flakTurret'
      AND "itemType" = 'defence'
      AND "itemKey" = 'flakTurret'
    )
  );
