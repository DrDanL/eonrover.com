-- Persist the exact accepted construction cost so cancellation never depends
-- on whatever balance formula happens to be deployed later.
ALTER TABLE "BuildQueueItem"
ADD COLUMN "costAlloy" INTEGER,
ADD COLUMN "costHeliox" INTEGER,
ADD COLUMN "costAether" INTEGER;

-- Backfill any pre-Stage-3B1 construction using the formula that accepted it.
UPDATE "BuildQueueItem"
SET
  "costAlloy" = CASE "buildingKey"
    WHEN 'alloyMine' THEN ROUND(60 * POWER(1.5, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'helioxExtractor' THEN ROUND(48 * POWER(1.5, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'aetherSynthesizer' THEN ROUND(200 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'solarArray' THEN ROUND(75 * POWER(1.5, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'alloyStorage' THEN ROUND(500 * POWER(2, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'helioxStorage' THEN ROUND(500 * POWER(2, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'aetherStorage' THEN ROUND(800 * POWER(2, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'shipyard' THEN ROUND(400 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'researchLab' THEN ROUND(250 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'gateObservatory' THEN ROUND(1200 * POWER(1.8, GREATEST("targetLevel" - 1, 0)))::INTEGER
  END,
  "costHeliox" = CASE "buildingKey"
    WHEN 'alloyMine' THEN ROUND(15 * POWER(1.5, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'helioxExtractor' THEN ROUND(24 * POWER(1.5, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'aetherSynthesizer' THEN ROUND(150 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'solarArray' THEN ROUND(30 * POWER(1.5, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'alloyStorage' THEN 0
    WHEN 'helioxStorage' THEN ROUND(250 * POWER(2, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'aetherStorage' THEN ROUND(400 * POWER(2, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'shipyard' THEN ROUND(200 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'researchLab' THEN ROUND(400 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'gateObservatory' THEN ROUND(900 * POWER(1.8, GREATEST("targetLevel" - 1, 0)))::INTEGER
  END,
  "costAether" = CASE "buildingKey"
    WHEN 'alloyMine' THEN 0
    WHEN 'helioxExtractor' THEN 0
    WHEN 'aetherSynthesizer' THEN 0
    WHEN 'solarArray' THEN 0
    WHEN 'alloyStorage' THEN 0
    WHEN 'helioxStorage' THEN 0
    WHEN 'aetherStorage' THEN ROUND(100 * POWER(2, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'shipyard' THEN ROUND(100 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'researchLab' THEN ROUND(100 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'gateObservatory' THEN ROUND(500 * POWER(1.8, GREATEST("targetLevel" - 1, 0)))::INTEGER
  END;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BuildQueueItem"
    WHERE "costAlloy" IS NULL OR "costHeliox" IS NULL OR "costAether" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot snapshot cost for an unknown legacy building key';
  END IF;
END $$;

ALTER TABLE "BuildQueueItem"
ALTER COLUMN "costAlloy" SET NOT NULL,
ALTER COLUMN "costHeliox" SET NOT NULL,
ALTER COLUMN "costAether" SET NOT NULL;
