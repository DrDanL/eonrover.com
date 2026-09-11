import { settleCanonicalTransport as settlePersistedCanonicalTransport, TransportCompletionOutcome } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { scheduleTransportReturnWakeup } from './transportArrivalSchedulingService';

export type { TransportCompletionOutcome } from '@eonrover/shared';

/** API wrapper around the shared transaction, with post-commit return wake-up dispatch. */
export function settleCanonicalTransport(missionId: string, currentTime = new Date()): Promise<TransportCompletionOutcome> {
  return settlePersistedCanonicalTransport(prisma, missionId, currentTime, { scheduleReturnWakeup: scheduleTransportReturnWakeup });
}
