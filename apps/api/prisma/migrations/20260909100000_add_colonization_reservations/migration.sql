-- Canonical colonisation snapshots are nullable so dormant legacy COLONIZE
-- missions remain readable without being reinterpreted or activated.
ALTER TABLE "FleetMission"
  ADD COLUMN "colonizationAccountId" TEXT,
  ADD COLUMN "colonizationTargetGalaxy" INTEGER,
  ADD COLUMN "colonizationTargetSystem" INTEGER,
  ADD COLUMN "colonizationTargetSlot" INTEGER,
  ADD COLUMN "colonizationShips" JSONB,
  ADD COLUMN "colonizationFuelHeliox" INTEGER,
  ADD COLUMN "colonizationDurationSeconds" INTEGER,
  ADD COLUMN "colonizationCharacteristics" JSONB,
  ADD COLUMN "colonizationStarterState" JSONB,
  ADD COLUMN "createdPlanetId" TEXT;

-- Target coordinates are either absent for a legacy row or form one valid,
-- bounded canonical snapshot. This deliberately causes malformed data to fail
-- at migration/insert time rather than becoming a reservation.
ALTER TABLE "FleetMission"
  ADD CONSTRAINT "FleetMission_colonization_target_coordinates_check"
  CHECK (
    (
      "colonizationTargetGalaxy" IS NULL
      AND "colonizationTargetSystem" IS NULL
      AND "colonizationTargetSlot" IS NULL
    )
    OR (
      "colonizationTargetGalaxy" > 0
      AND "colonizationTargetSystem" > 0
      AND "colonizationTargetSlot" BETWEEN 1 AND 12
    )
  );

ALTER TABLE "FleetMission"
  ADD CONSTRAINT "FleetMission_colonizationAccountId_fkey"
    FOREIGN KEY ("colonizationAccountId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FleetMission_createdPlanetId_fkey"
    FOREIGN KEY ("createdPlanetId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FleetMission_colonizationAccountId_idx" ON "FleetMission"("colonizationAccountId");
CREATE UNIQUE INDEX "FleetMission_createdPlanetId_key" ON "FleetMission"("createdPlanetId");

-- These indexes intentionally exclude dormant legacy COLONIZE rows. PostgreSQL
-- rejects an unsafe legacy upgrade clearly if any already-populated canonical
-- reservation snapshots violate either future invariant.
CREATE UNIQUE INDEX "FleetMission_one_outbound_canonical_colonization_per_account"
  ON "FleetMission"("colonizationAccountId")
  WHERE "missionType" = 'COLONIZE'
    AND "status" = 'OUTBOUND'
    AND "colonizationAccountId" IS NOT NULL
    AND "colonizationTargetGalaxy" IS NOT NULL
    AND "colonizationTargetSystem" IS NOT NULL
    AND "colonizationTargetSlot" IS NOT NULL;

CREATE UNIQUE INDEX "FleetMission_one_outbound_canonical_colonization_per_coordinate"
  ON "FleetMission"("colonizationTargetGalaxy", "colonizationTargetSystem", "colonizationTargetSlot")
  WHERE "missionType" = 'COLONIZE'
    AND "status" = 'OUTBOUND'
    AND "colonizationAccountId" IS NOT NULL
    AND "colonizationTargetGalaxy" IS NOT NULL
    AND "colonizationTargetSystem" IS NOT NULL
    AND "colonizationTargetSlot" IS NOT NULL;
