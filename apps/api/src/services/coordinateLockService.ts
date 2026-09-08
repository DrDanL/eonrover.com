import { Prisma } from '@prisma/client';

export interface CoordinateLockCoordinate {
  galaxy: number;
  system: number;
  slot: number;
}

function validCoordinatePart(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * A stable advisory-lock key for one exact coordinate. Hash collisions are
 * harmless: they only serialize unrelated claims, while callers still verify
 * the full coordinate under the transaction lock before writing state.
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

/**
 * Acquires a PostgreSQL transaction-scoped advisory lock shared by homeworld
 * allocation and future canonical colonisation reservation transactions.
 */
export async function lockCoordinateForTransaction(
  tx: Prisma.TransactionClient,
  coordinate: CoordinateLockCoordinate,
): Promise<void> {
  const key = coordinateAdvisoryLockKey(coordinate);
  // Prisma cannot deserialize PostgreSQL's `void` function result, so select
  // an ordinary marker from the lock invocation rather than returning it.
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${key})`;
}
