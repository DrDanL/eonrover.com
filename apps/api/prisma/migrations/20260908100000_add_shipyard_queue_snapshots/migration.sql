-- Stage 7B: persist the accepted batch economics and duration. Existing
-- quantity/startedAt/completesAt are already the durable accepted quantity and
-- timestamps, so only the missing snapshots are added here.
ALTER TABLE "ShipyardQueueItem"
  ADD COLUMN "costAlloy" INTEGER,
  ADD COLUMN "costHeliox" INTEGER,
  ADD COLUMN "costAether" INTEGER,
  ADD COLUMN "durationSeconds" INTEGER;

-- Legacy rows predate accepted snapshots. Costs are the historic canonical
-- definition cost multiplied by the accepted quantity; duration is the
-- persisted timestamp interval because legacy workers rewrote completesAt for
-- each unit and no original accepted duration exists. Unknown keys fail below
-- rather than receiving invented economics.
UPDATE "ShipyardQueueItem"
SET
  "costAlloy" = "quantity" * CASE "itemKey"
    WHEN 'scout' THEN 2000 WHEN 'probe' THEN 800 WHEN 'transporter' THEN 3000
    WHEN 'colonyShip' THEN 12000 WHEN 'corvette' THEN 4000 WHEN 'frigate' THEN 9000
    WHEN 'recycler' THEN 5000 WHEN 'flakTurret' THEN 2000 WHEN 'railBattery' THEN 6000
    WHEN 'planetaryShield' THEN 15000 END,
  "costHeliox" = "quantity" * CASE "itemKey"
    WHEN 'scout' THEN 1000 WHEN 'probe' THEN 400 WHEN 'transporter' THEN 1500
    WHEN 'colonyShip' THEN 8000 WHEN 'corvette' THEN 1200 WHEN 'frigate' THEN 4000
    WHEN 'recycler' THEN 3000 WHEN 'flakTurret' THEN 0 WHEN 'railBattery' THEN 2000
    WHEN 'planetaryShield' THEN 8000 END,
  "costAether" = "quantity" * CASE "itemKey"
    WHEN 'scout' THEN 0 WHEN 'probe' THEN 0 WHEN 'transporter' THEN 0
    WHEN 'colonyShip' THEN 2000 WHEN 'corvette' THEN 0 WHEN 'frigate' THEN 500
    WHEN 'recycler' THEN 0 WHEN 'flakTurret' THEN 0 WHEN 'railBattery' THEN 0
    WHEN 'planetaryShield' THEN 1000 END,
  "durationSeconds" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM ("completesAt" - "startedAt")))::INTEGER);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ShipyardQueueItem"
    WHERE "quantity" < 1 OR "remaining" < 0 OR "remaining" > "quantity"
       OR "costAlloy" IS NULL OR "costHeliox" IS NULL OR "costAether" IS NULL
       OR "durationSeconds" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot snapshot an invalid or unknown legacy Shipyard queue row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ShipyardQueueItem" WHERE "status" = 'PENDING'
    GROUP BY "planetId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one pending Shipyard batch per planet: duplicate legacy pending rows exist';
  END IF;
END $$;

ALTER TABLE "ShipyardQueueItem"
  ALTER COLUMN "costAlloy" SET NOT NULL,
  ALTER COLUMN "costHeliox" SET NOT NULL,
  ALTER COLUMN "costAether" SET NOT NULL,
  ALTER COLUMN "durationSeconds" SET NOT NULL;

CREATE UNIQUE INDEX "ShipyardQueueItem_one_pending_per_planet"
  ON "ShipyardQueueItem" ("planetId") WHERE "status" = 'PENDING';
