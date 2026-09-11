import {
  ColonizationCompletionOutcome,
  completeCanonicalColonization as completePersistedCanonicalColonization,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';

export type { ColonizationCompletionOutcome } from '@eonrover/shared';

/**
 * API-facing compatibility wrapper. The shared transaction is also used by
 * the dedicated worker so every canonical arrival follows the same
 * PostgreSQL-authoritative completion path.
 */
export async function completeCanonicalColonization(
  missionId: string,
  currentTime = new Date(),
): Promise<ColonizationCompletionOutcome> {
  return completePersistedCanonicalColonization(prisma, missionId, currentTime);
}
