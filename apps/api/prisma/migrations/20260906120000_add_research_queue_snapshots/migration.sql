-- Stage 6B: make the account owner and accepted research economics durable.
ALTER TABLE "ResearchQueueItem"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "costAlloy" INTEGER,
  ADD COLUMN "costHeliox" INTEGER,
  ADD COLUMN "costAether" INTEGER,
  ADD COLUMN "durationSeconds" INTEGER;

UPDATE "ResearchQueueItem" item
SET "userId" = planet."ownerId"
FROM "Planet" planet
WHERE planet."id" = item."planetId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ResearchQueueItem" WHERE "userId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill research queue owner because its originating planet is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ResearchQueueItem"
    WHERE "status" = 'PENDING'
    GROUP BY "userId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active research per account: duplicate legacy pending research rows exist';
  END IF;
END $$;

UPDATE "ResearchQueueItem"
SET
  "costAlloy" = CASE "researchKey"
    WHEN 'alloyProcessing' THEN ROUND(200 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'helioxCombustion' THEN ROUND(150 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'aetherPhysics' THEN ROUND(300 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'propulsionTheory' THEN ROUND(300 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'espionageTech' THEN ROUND(200 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'shieldTech' THEN ROUND(300 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'weaponTech' THEN ROUND(300 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'armourTech' THEN ROUND(300 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'gateTheory' THEN ROUND(1000 * POWER(1.8, GREATEST("targetLevel" - 1, 0)))::INTEGER END,
  "costHeliox" = CASE "researchKey"
    WHEN 'alloyProcessing' THEN ROUND(100 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'helioxCombustion' THEN ROUND(200 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'aetherPhysics' THEN ROUND(300 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'propulsionTheory' THEN ROUND(200 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'espionageTech' THEN ROUND(400 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'shieldTech' THEN ROUND(300 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'weaponTech' THEN ROUND(300 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'armourTech' THEN ROUND(300 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'gateTheory' THEN ROUND(1000 * POWER(1.8, GREATEST("targetLevel" - 1, 0)))::INTEGER END,
  "costAether" = CASE "researchKey"
    WHEN 'alloyProcessing' THEN 0 WHEN 'helioxCombustion' THEN 0
    WHEN 'aetherPhysics' THEN ROUND(50 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'propulsionTheory' THEN ROUND(20 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'espionageTech' THEN ROUND(20 * POWER(1.6, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'shieldTech' THEN ROUND(40 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'weaponTech' THEN ROUND(40 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'armourTech' THEN ROUND(40 * POWER(1.7, GREATEST("targetLevel" - 1, 0)))::INTEGER
    WHEN 'gateTheory' THEN ROUND(400 * POWER(1.8, GREATEST("targetLevel" - 1, 0)))::INTEGER END,
  "durationSeconds" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM ("completesAt" - "startedAt")))::INTEGER);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ResearchQueueItem" WHERE "costAlloy" IS NULL OR "costHeliox" IS NULL OR "costAether" IS NULL) THEN
    RAISE EXCEPTION 'Cannot snapshot cost for an unknown legacy research key';
  END IF;
END $$;

ALTER TABLE "ResearchQueueItem"
  ALTER COLUMN "userId" SET NOT NULL,
  ALTER COLUMN "costAlloy" SET NOT NULL,
  ALTER COLUMN "costHeliox" SET NOT NULL,
  ALTER COLUMN "costAether" SET NOT NULL,
  ALTER COLUMN "durationSeconds" SET NOT NULL;
ALTER TABLE "ResearchQueueItem" ADD CONSTRAINT "ResearchQueueItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ResearchQueueItem_userId_status_idx" ON "ResearchQueueItem"("userId", "status");
CREATE UNIQUE INDEX "ResearchQueueItem_one_pending_per_user" ON "ResearchQueueItem"("userId") WHERE "status" = 'PENDING';
