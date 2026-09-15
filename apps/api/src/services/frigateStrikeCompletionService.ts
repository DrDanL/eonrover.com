import { FrigateStrikeCompletionOutcome, settleCanonicalFrigateStrike as settle } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { scheduleFrigateStrikeReturnWakeup } from './frigateStrikeArrivalSchedulingService';

export type { FrigateStrikeCompletionOutcome } from '@eonrover/shared';

/** Internal fallback only; PostgreSQL settles the mission before Redis is asked to wake its return. */
export const settleCanonicalFrigateStrike = (missionId: string, currentTime = new Date()): Promise<FrigateStrikeCompletionOutcome> =>
  settle(prisma, missionId, currentTime, { scheduleReturnWakeup: scheduleFrigateStrikeReturnWakeup });
