-- Canonical transport snapshots are nullable so legacy generic TRANSPORT rows
-- remain readable without reinterpreting legacy JSON, timing, status, or job
-- fields. Canonical transport lifecycle is isolated from MissionStatus.
DO $$
BEGIN
  CREATE TYPE "TransportMissionPhase" AS ENUM (
    'OUTBOUND',
    'AWAITING_DESTINATION_CAPACITY',
    'RETURNING',
    'COMPLETE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "FleetMission"
  ADD COLUMN IF NOT EXISTS "transportOriginId" TEXT,
  ADD COLUMN IF NOT EXISTS "transportDestinationId" TEXT,
  ADD COLUMN IF NOT EXISTS "transportShips" JSONB,
  ADD COLUMN IF NOT EXISTS "transportCargo" JSONB,
  ADD COLUMN IF NOT EXISTS "transportRemainingCargo" JSONB,
  ADD COLUMN IF NOT EXISTS "transportCapacity" INTEGER,
  ADD COLUMN IF NOT EXISTS "transportOutboundFuelHeliox" INTEGER,
  ADD COLUMN IF NOT EXISTS "transportReturnFuelHeliox" INTEGER,
  ADD COLUMN IF NOT EXISTS "transportTotalReservedFuelHeliox" INTEGER,
  ADD COLUMN IF NOT EXISTS "transportOutboundDurationSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "transportReturnDurationSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "transportPhase" "TransportMissionPhase";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FleetMission_transportOriginId_fkey') THEN
    ALTER TABLE "FleetMission"
      ADD CONSTRAINT "FleetMission_transportOriginId_fkey"
      FOREIGN KEY ("transportOriginId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FleetMission_transportDestinationId_fkey') THEN
    ALTER TABLE "FleetMission"
      ADD CONSTRAINT "FleetMission_transportDestinationId_fkey"
      FOREIGN KEY ("transportDestinationId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX "FleetMission_transportOriginId_transportPhase_idx"
  ON "FleetMission"("transportOriginId", "transportPhase");
CREATE INDEX "FleetMission_transportDestinationId_idx"
  ON "FleetMission"("transportDestinationId");

-- This deliberately excludes all legacy rows: canonical phase and both
-- canonical planet references must be populated. PostgreSQL rejects an unsafe
-- upgrade at this named index if pre-existing canonical active rows collide.
CREATE UNIQUE INDEX "FleetMission_one_active_canonical_transport_per_origin"
  ON "FleetMission"("transportOriginId")
  WHERE "missionType" = 'TRANSPORT'
    AND "transportOriginId" IS NOT NULL
    AND "transportDestinationId" IS NOT NULL
    AND "transportPhase" IN ('OUTBOUND', 'AWAITING_DESTINATION_CAPACITY', 'RETURNING');
