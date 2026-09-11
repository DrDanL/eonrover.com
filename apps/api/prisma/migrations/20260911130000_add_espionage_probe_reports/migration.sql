-- Canonical Probe reports are deliberately separate from legacy raw
-- EspionageReport rows. No legacy report, FleetMission JSON, status, timing,
-- or result data is rewritten or used as authority by this migration.
DO $$
BEGIN
  CREATE TYPE "EspionageProbeDisclosureTier" AS ENUM (
    'IDENTITY',
    'RESOURCES',
    'BUILDINGS',
    'FORCES'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "EspionageProbeReport" (
  "id" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "attackerId" TEXT NOT NULL,
  "targetPlanetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "tier" "EspionageProbeDisclosureTier" NOT NULL,
  "disclosureSnapshot" JSONB NOT NULL,

  CONSTRAINT "EspionageProbeReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EspionageProbeReport_missionId_key"
  ON "EspionageProbeReport"("missionId");
CREATE INDEX "EspionageProbeReport_attackerId_createdAt_idx"
  ON "EspionageProbeReport"("attackerId", "createdAt");
CREATE INDEX "EspionageProbeReport_targetPlanetId_idx"
  ON "EspionageProbeReport"("targetPlanetId");

ALTER TABLE "EspionageProbeReport"
  ADD CONSTRAINT "EspionageProbeReport_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "FleetMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EspionageProbeReport"
  ADD CONSTRAINT "EspionageProbeReport_attackerId_fkey"
  FOREIGN KEY ("attackerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EspionageProbeReport"
  ADD CONSTRAINT "EspionageProbeReport_targetPlanetId_fkey"
  FOREIGN KEY ("targetPlanetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A report can only attach to the canonical Probe lifecycle and its persisted
-- authoritative attacker/target references. Legacy generic ESPIONAGE rows
-- therefore cannot be repurposed as canonical reports.
CREATE FUNCTION "validate_espionage_probe_report_mission"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FleetMission" AS mission
    WHERE mission."id" = NEW."missionId"
      AND mission."missionType" = 'ESPIONAGE'
      AND mission."espionageProbePhase" IS NOT NULL
      AND mission."espionageOriginPlanetId" IS NOT NULL
      AND mission."espionageTargetPlanetId" IS NOT NULL
      AND mission."espionageOriginAccountId" = NEW."attackerId"
      AND mission."espionageTargetPlanetId" = NEW."targetPlanetId"
      AND mission."espionageProbeShips" IS NOT NULL
      AND mission."espionageOutboundFuelHeliox" IS NOT NULL
      AND mission."espionageReturnFuelHeliox" IS NOT NULL
      AND mission."espionageOutboundDurationSeconds" IS NOT NULL
      AND mission."espionageReturnDurationSeconds" IS NOT NULL
      AND mission."arrivesAt" IS NOT NULL
      AND mission."returnsAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'EspionageProbeReport requires a canonical Espionage Probe mission';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EspionageProbeReport_canonical_mission_only"
  BEFORE INSERT ON "EspionageProbeReport"
  FOR EACH ROW EXECUTE FUNCTION "validate_espionage_probe_report_mission"();

-- Canonical disclosure snapshots are final arrival facts. Keeping the row
-- immutable prevents later code from silently changing tier, ownership, or
-- report data after it has been persisted.
CREATE FUNCTION "reject_espionage_probe_report_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'EspionageProbeReport rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EspionageProbeReport_immutable"
  BEFORE UPDATE ON "EspionageProbeReport"
  FOR EACH ROW EXECUTE FUNCTION "reject_espionage_probe_report_update"();
