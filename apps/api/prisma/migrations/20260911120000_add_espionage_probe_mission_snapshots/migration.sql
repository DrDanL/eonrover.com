-- Canonical Espionage Probe snapshots are nullable so legacy generic
-- ESPIONAGE missions remain readable without reinterpreting legacy JSON,
-- status, timing, report, or job fields. The established generic travel
-- timestamps remain the authoritative departure/arrival/return references
-- only when a future lifecycle verifies the canonical snapshots below.
DO $$
BEGIN
  CREATE TYPE "EspionageProbeMissionPhase" AS ENUM (
    'OUTBOUND',
    'RETURNING',
    'COMPLETE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "FleetMission"
  ADD COLUMN IF NOT EXISTS "espionageOriginPlanetId" TEXT,
  ADD COLUMN IF NOT EXISTS "espionageTargetPlanetId" TEXT,
  ADD COLUMN IF NOT EXISTS "espionageOriginAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "espionageTargetAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "espionageProbeShips" JSONB,
  ADD COLUMN IF NOT EXISTS "espionageOutboundFuelHeliox" INTEGER,
  ADD COLUMN IF NOT EXISTS "espionageReturnFuelHeliox" INTEGER,
  ADD COLUMN IF NOT EXISTS "espionageOutboundDurationSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "espionageReturnDurationSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "espionageProbePhase" "EspionageProbeMissionPhase";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FleetMission_espionageOriginPlanetId_fkey') THEN
    ALTER TABLE "FleetMission"
      ADD CONSTRAINT "FleetMission_espionageOriginPlanetId_fkey"
      FOREIGN KEY ("espionageOriginPlanetId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FleetMission_espionageTargetPlanetId_fkey') THEN
    ALTER TABLE "FleetMission"
      ADD CONSTRAINT "FleetMission_espionageTargetPlanetId_fkey"
      FOREIGN KEY ("espionageTargetPlanetId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FleetMission_espionageOriginAccountId_fkey') THEN
    ALTER TABLE "FleetMission"
      ADD CONSTRAINT "FleetMission_espionageOriginAccountId_fkey"
      FOREIGN KEY ("espionageOriginAccountId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FleetMission_espionageTargetAccountId_fkey') THEN
    ALTER TABLE "FleetMission"
      ADD CONSTRAINT "FleetMission_espionageTargetAccountId_fkey"
      FOREIGN KEY ("espionageTargetAccountId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX "FleetMission_espionageOriginPlanetId_espionageProbePhase_idx"
  ON "FleetMission"("espionageOriginPlanetId", "espionageProbePhase");
CREATE INDEX "FleetMission_espionageTargetPlanetId_idx"
  ON "FleetMission"("espionageTargetPlanetId");
CREATE INDEX "FleetMission_espionageOriginAccountId_idx"
  ON "FleetMission"("espionageOriginAccountId");
CREATE INDEX "FleetMission_espionageTargetAccountId_idx"
  ON "FleetMission"("espionageTargetAccountId");
CREATE INDEX "FleetMission_espionageProbePhase_arrivesAt_idx"
  ON "FleetMission"("espionageProbePhase", "arrivesAt")
  WHERE "missionType" = 'ESPIONAGE'
    AND "espionageProbePhase" = 'OUTBOUND'
    AND "espionageOriginPlanetId" IS NOT NULL
    AND "espionageTargetPlanetId" IS NOT NULL;
CREATE INDEX "FleetMission_espionageProbePhase_returnsAt_idx"
  ON "FleetMission"("espionageProbePhase", "returnsAt")
  WHERE "missionType" = 'ESPIONAGE'
    AND "espionageProbePhase" = 'RETURNING'
    AND "espionageOriginPlanetId" IS NOT NULL
    AND "espionageTargetPlanetId" IS NOT NULL;

-- This deliberately excludes all legacy ESPIONAGE rows. PostgreSQL rejects an
-- unsafe upgrade clearly at this named index if already-populated canonical
-- active Probe rows collide for the same origin.
CREATE UNIQUE INDEX "FleetMission_one_active_canonical_espionage_probe_per_origin"
  ON "FleetMission"("espionageOriginPlanetId")
  WHERE "missionType" = 'ESPIONAGE'
    AND "espionageProbePhase" IN ('OUTBOUND', 'RETURNING')
    AND "espionageOriginPlanetId" IS NOT NULL
    AND "espionageTargetPlanetId" IS NOT NULL
    AND "espionageOriginAccountId" IS NOT NULL
    AND "espionageTargetAccountId" IS NOT NULL;
