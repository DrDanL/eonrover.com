export interface CoordinateLockCoordinate {
  galaxy: number;
  system: number;
  slot: number;
}

interface AdvisoryLockTransaction {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

function validCoordinatePart(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * A stable advisory-lock key for one exact coordinate. Hash collisions are
 * harmless: callers still verify the complete coordinate before writing.
 */
export function coordinateAdvisoryLockKey(coordinate: CoordinateLockCoordinate): bigint {
  if (!validCoordinatePart(coordinate.galaxy)
    || !validCoordinatePart(coordinate.system)
    || !validCoordinatePart(coordinate.slot)) {
    throw new TypeError('Coordinate lock values must be positive safe integers.');
  }

  let hash = 0x811c9dc5;
  for (const character of `${coordinate.galaxy}:${coordinate.system}:${coordinate.slot}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return BigInt(hash >>> 0);
}

/** Acquires the transaction-scoped coordinate lock used by all trusted claims. */
export async function lockCoordinateForTransaction(
  tx: AdvisoryLockTransaction,
  coordinate: CoordinateLockCoordinate,
): Promise<void> {
  const key = coordinateAdvisoryLockKey(coordinate);
  // Prisma cannot deserialize pg_advisory_xact_lock's void result directly.
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${key})`;
}
