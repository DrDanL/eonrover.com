-- Canonical Corvette strikes are opt-in nullable snapshots. Legacy FleetMission
-- rows remain untouched and therefore cannot participate in these invariants.
CREATE TYPE "CorvetteStrikePhase" AS ENUM ('OUTBOUND', 'RETURNING', 'COMPLETE');

ALTER TABLE "FleetMission"
  ADD COLUMN "corvetteStrikeOriginPlanetId" TEXT,
  ADD COLUMN "corvetteStrikeTargetPlanetId" TEXT,
  ADD COLUMN "corvetteStrikeAttackerId" TEXT,
  ADD COLUMN "corvetteStrikeDefenderId" TEXT,
  ADD COLUMN "corvetteStrikeShips" JSONB,
  ADD COLUMN "corvetteStrikeOutboundFuelHeliox" INTEGER,
  ADD COLUMN "corvetteStrikeReturnFuelHeliox" INTEGER,
  ADD COLUMN "corvetteStrikeOutboundDurationSeconds" INTEGER,
  ADD COLUMN "corvetteStrikeReturnDurationSeconds" INTEGER,
  ADD COLUMN "corvetteStrikeResolverVersion" TEXT,
  ADD COLUMN "corvetteStrikeResolverSeed" TEXT,
  ADD COLUMN "corvetteStrikeAttackerTechnology" JSONB,
  ADD COLUMN "corvetteStrikePhase" "CorvetteStrikePhase";

ALTER TABLE "FleetMission"
  ADD CONSTRAINT "FleetMission_corvetteStrikeOriginPlanetId_fkey" FOREIGN KEY ("corvetteStrikeOriginPlanetId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FleetMission_corvetteStrikeTargetPlanetId_fkey" FOREIGN KEY ("corvetteStrikeTargetPlanetId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FleetMission_corvetteStrikeAttackerId_fkey" FOREIGN KEY ("corvetteStrikeAttackerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FleetMission_corvetteStrikeDefenderId_fkey" FOREIGN KEY ("corvetteStrikeDefenderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CorvetteStrikeReport" (
  "id" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "attackerId" TEXT NOT NULL,
  "defenderId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "resolverVersion" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  CONSTRAINT "CorvetteStrikeReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorvetteStrikeReport_missionId_key" ON "CorvetteStrikeReport"("missionId");
CREATE INDEX "CorvetteStrikeReport_attackerId_createdAt_idx" ON "CorvetteStrikeReport"("attackerId", "createdAt");
CREATE INDEX "CorvetteStrikeReport_defenderId_createdAt_idx" ON "CorvetteStrikeReport"("defenderId", "createdAt");
ALTER TABLE "CorvetteStrikeReport"
  ADD CONSTRAINT "CorvetteStrikeReport_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "FleetMission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CorvetteStrikeReport_attackerId_fkey" FOREIGN KEY ("attackerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CorvetteStrikeReport_defenderId_fkey" FOREIGN KEY ("defenderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "FleetMission_corvetteStrikeOriginPlanetId_corvetteStrikePhase_idx" ON "FleetMission"("corvetteStrikeOriginPlanetId", "corvetteStrikePhase");
CREATE INDEX "FleetMission_corvetteStrikeTargetPlanetId_idx" ON "FleetMission"("corvetteStrikeTargetPlanetId");
CREATE INDEX "FleetMission_corvetteStrikeAttackerId_idx" ON "FleetMission"("corvetteStrikeAttackerId");
CREATE INDEX "FleetMission_corvetteStrikeDefenderId_idx" ON "FleetMission"("corvetteStrikeDefenderId");
CREATE INDEX "FleetMission_corvetteStrikePhase_arrivesAt_idx" ON "FleetMission"("corvetteStrikePhase", "arrivesAt");
CREATE INDEX "FleetMission_corvetteStrikePhase_returnsAt_idx" ON "FleetMission"("corvetteStrikePhase", "returnsAt");

-- This is intentionally the final statement: unsafe historical canonical
-- duplicates fail visibly, with no migration ledger entry and no data rewrite.
CREATE UNIQUE INDEX "FleetMission_one_active_canonical_corvette_strike_per_origin"
  ON "FleetMission"("corvetteStrikeOriginPlanetId")
  WHERE "missionType" = 'ATTACK'
    AND "corvetteStrikeOriginPlanetId" IS NOT NULL
    AND "corvetteStrikeTargetPlanetId" IS NOT NULL
    AND "corvetteStrikeAttackerId" IS NOT NULL
    AND "corvetteStrikeDefenderId" IS NOT NULL
    AND "corvetteStrikePhase" IN ('OUTBOUND', 'RETURNING');
