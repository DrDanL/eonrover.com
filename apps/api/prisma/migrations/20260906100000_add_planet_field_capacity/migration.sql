-- Add an explicit, positive building-field capacity without rewriting any
-- completed levels or accepted construction records.
ALTER TABLE "Planet" ADD COLUMN "fieldCapacity" INTEGER;

-- Existing planets receive the normal 180-field capacity. Planets already
-- using at least that many completed fields retain ten fields of headroom.
UPDATE "Planet" AS planet
SET "fieldCapacity" = CASE
  WHEN COALESCE(
    (
      SELECT SUM(GREATEST(building."level", 0))::INTEGER
      FROM "Building" AS building
      WHERE building."planetId" = planet."id"
    ),
    0
  ) >= 180
  THEN COALESCE(
    (
      SELECT SUM(GREATEST(building."level", 0))::INTEGER
      FROM "Building" AS building
      WHERE building."planetId" = planet."id"
    ),
    0
  ) + 10
  ELSE 180
END;

ALTER TABLE "Planet"
  ALTER COLUMN "fieldCapacity" SET DEFAULT 180,
  ALTER COLUMN "fieldCapacity" SET NOT NULL;

ALTER TABLE "Planet"
  ADD CONSTRAINT "Planet_fieldCapacity_positive" CHECK ("fieldCapacity" > 0);
