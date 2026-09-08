-- Canonical Stage 8B deploy fields are deliberately nullable so historical
-- generic FleetMission rows remain readable without reinterpretation.
ALTER TABLE "FleetMission"
  ADD COLUMN "deployOriginId" TEXT,
  ADD COLUMN "deployDestinationId" TEXT,
  ADD COLUMN "deployShips" JSONB,
  ADD COLUMN "deployFuelHeliox" INTEGER,
  ADD COLUMN "deployDurationSeconds" INTEGER;

ALTER TABLE "FleetMission"
  ADD CONSTRAINT "FleetMission_deployOriginId_fkey" FOREIGN KEY ("deployOriginId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FleetMission_deployDestinationId_fkey" FOREIGN KEY ("deployDestinationId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FleetMission_deployOriginId_idx" ON "FleetMission"("deployOriginId");
CREATE INDEX "FleetMission_deployDestinationId_idx" ON "FleetMission"("deployDestinationId");

-- PostgreSQL fails this migration clearly if legacy outbound DEPLOY rows already
-- violate the future one-deploy-per-origin invariant.
CREATE UNIQUE INDEX "FleetMission_one_outbound_deploy_per_origin"
  ON "FleetMission"("originId")
  WHERE "missionType" = 'DEPLOY' AND "status" = 'OUTBOUND';
