-- Canonical Corvette reports are future immutable resolution facts. Legacy
-- combat reports and generic FleetMission rows are intentionally untouched.
CREATE FUNCTION "validate_corvette_strike_report_mission"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "FleetMission" mission
    WHERE mission."id" = NEW."missionId"
      AND mission."missionType" = 'ATTACK'
      AND mission."corvetteStrikePhase" IS NOT NULL
      AND mission."corvetteStrikeOriginPlanetId" IS NOT NULL
      AND mission."corvetteStrikeTargetPlanetId" IS NOT NULL
      AND mission."corvetteStrikeAttackerId" = NEW."attackerId"
      AND mission."corvetteStrikeDefenderId" = NEW."defenderId"
      AND mission."corvetteStrikeShips" IS NOT NULL
      AND mission."corvetteStrikeResolverVersion" IS NOT NULL
      AND mission."corvetteStrikeResolverSeed" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'CorvetteStrikeReport requires a canonical Corvette strike mission';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CorvetteStrikeReport_canonical_mission_only"
  BEFORE INSERT ON "CorvetteStrikeReport"
  FOR EACH ROW EXECUTE FUNCTION "validate_corvette_strike_report_mission"();

CREATE FUNCTION "reject_corvette_strike_report_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CorvetteStrikeReport rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CorvetteStrikeReport_immutable"
  BEFORE UPDATE ON "CorvetteStrikeReport"
  FOR EACH ROW EXECUTE FUNCTION "reject_corvette_strike_report_update"();
