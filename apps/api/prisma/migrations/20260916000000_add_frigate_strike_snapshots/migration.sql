-- Canonical Frigate strikes are nullable opt-in snapshots. Existing ATTACK
-- rows, canonical Corvette strikes, and legacy JSON remain untouched.
CREATE TYPE "FrigateStrikePhase" AS ENUM ('OUTBOUND', 'RETURNING', 'COMPLETE');

ALTER TABLE "FleetMission"
  ADD COLUMN "frigateStrikeOriginPlanetId" TEXT,
  ADD COLUMN "frigateStrikeTargetPlanetId" TEXT,
  ADD COLUMN "frigateStrikeAttackerId" TEXT,
  ADD COLUMN "frigateStrikeDefenderId" TEXT,
  ADD COLUMN "frigateStrikeShips" JSONB,
  ADD COLUMN "frigateStrikeOutboundFuelHeliox" INTEGER,
  ADD COLUMN "frigateStrikeReturnFuelHeliox" INTEGER,
  ADD COLUMN "frigateStrikeOutboundDurationSeconds" INTEGER,
  ADD COLUMN "frigateStrikeReturnDurationSeconds" INTEGER,
  ADD COLUMN "frigateStrikeResolverVersion" TEXT,
  ADD COLUMN "frigateStrikeResolverSeed" TEXT,
  ADD COLUMN "frigateStrikeAttackerTechnology" JSONB,
  ADD COLUMN "frigateStrikePhase" "FrigateStrikePhase";

ALTER TABLE "FleetMission"
  ADD CONSTRAINT "FleetMission_frigateStrikeOriginPlanetId_fkey" FOREIGN KEY ("frigateStrikeOriginPlanetId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FleetMission_frigateStrikeTargetPlanetId_fkey" FOREIGN KEY ("frigateStrikeTargetPlanetId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FleetMission_frigateStrikeAttackerId_fkey" FOREIGN KEY ("frigateStrikeAttackerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FleetMission_frigateStrikeDefenderId_fkey" FOREIGN KEY ("frigateStrikeDefenderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FrigateStrikeReport" (
  "id" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "attackerId" TEXT NOT NULL,
  "defenderId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "resolverVersion" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  CONSTRAINT "FrigateStrikeReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FrigateStrikeReport_missionId_key" ON "FrigateStrikeReport"("missionId");
CREATE INDEX "FrigateStrikeReport_attackerId_createdAt_idx" ON "FrigateStrikeReport"("attackerId", "createdAt");
CREATE INDEX "FrigateStrikeReport_defenderId_createdAt_idx" ON "FrigateStrikeReport"("defenderId", "createdAt");
ALTER TABLE "FrigateStrikeReport"
  ADD CONSTRAINT "FrigateStrikeReport_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "FleetMission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "FrigateStrikeReport_attackerId_fkey" FOREIGN KEY ("attackerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "FrigateStrikeReport_defenderId_fkey" FOREIGN KEY ("defenderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "FleetMission_frigateStrikeOriginPlanetId_frigateStrikePhase_idx" ON "FleetMission"("frigateStrikeOriginPlanetId", "frigateStrikePhase");
CREATE INDEX "FleetMission_frigateStrikeTargetPlanetId_idx" ON "FleetMission"("frigateStrikeTargetPlanetId");
CREATE INDEX "FleetMission_frigateStrikeAttackerId_idx" ON "FleetMission"("frigateStrikeAttackerId");
CREATE INDEX "FleetMission_frigateStrikeDefenderId_idx" ON "FleetMission"("frigateStrikeDefenderId");
CREATE INDEX "FleetMission_frigateStrikePhase_arrivesAt_idx" ON "FleetMission"("frigateStrikePhase", "arrivesAt");
CREATE INDEX "FleetMission_frigateStrikePhase_returnsAt_idx" ON "FleetMission"("frigateStrikePhase", "returnsAt");

CREATE FUNCTION "validate_frigate_strike_report_mission"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "FleetMission" mission
    WHERE mission."id" = NEW."missionId"
      AND mission."missionType" = 'ATTACK'
      AND mission."frigateStrikePhase" IS NOT NULL
      AND mission."frigateStrikeOriginPlanetId" IS NOT NULL
      AND mission."frigateStrikeTargetPlanetId" IS NOT NULL
      AND mission."frigateStrikeAttackerId" = NEW."attackerId"
      AND mission."frigateStrikeDefenderId" = NEW."defenderId"
      AND mission."frigateStrikeShips" IS NOT NULL
      AND mission."frigateStrikeResolverVersion" IS NOT NULL
      AND mission."frigateStrikeResolverSeed" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FrigateStrikeReport requires a canonical Frigate strike mission';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FrigateStrikeReport_canonical_mission_only" BEFORE INSERT ON "FrigateStrikeReport" FOR EACH ROW EXECUTE FUNCTION "validate_frigate_strike_report_mission"();

CREATE FUNCTION "reject_frigate_strike_report_update"()
RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'FrigateStrikeReport rows are immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "FrigateStrikeReport_immutable" BEFORE UPDATE ON "FrigateStrikeReport" FOR EACH ROW EXECUTE FUNCTION "reject_frigate_strike_report_update"();

-- Final statement deliberately exposes unsafe pre-existing canonical duplicates.
CREATE UNIQUE INDEX "FleetMission_one_active_canonical_frigate_strike_per_origin"
  ON "FleetMission"("frigateStrikeOriginPlanetId")
  WHERE "missionType" = 'ATTACK'
    AND "frigateStrikeOriginPlanetId" IS NOT NULL
    AND "frigateStrikeTargetPlanetId" IS NOT NULL
    AND "frigateStrikeAttackerId" IS NOT NULL
    AND "frigateStrikeDefenderId" IS NOT NULL
    AND "frigateStrikePhase" IN ('OUTBOUND', 'RETURNING');
