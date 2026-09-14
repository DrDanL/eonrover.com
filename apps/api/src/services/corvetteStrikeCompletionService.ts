import { CorvetteStrikeCompletionOutcome, settleCanonicalCorvetteStrike as settle } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { scheduleCorvetteStrikeReturnWakeup } from './corvetteStrikeArrivalSchedulingService';

export type { CorvetteStrikeCompletionOutcome } from '@eonrover/shared';
/** API/internal fallback wrapper; queue dispatch occurs only after the transaction commits. */
export const settleCanonicalCorvetteStrike = (missionId: string, currentTime = new Date()): Promise<CorvetteStrikeCompletionOutcome> =>
  settle(prisma, missionId, currentTime, { scheduleReturnWakeup: scheduleCorvetteStrikeReturnWakeup });
