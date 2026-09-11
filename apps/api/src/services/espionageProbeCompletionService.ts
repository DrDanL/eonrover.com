import {
  EspionageProbeCompletionOutcome,
  settleCanonicalEspionageProbe as settlePersistedCanonicalEspionageProbe,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { scheduleEspionageProbeReturnWakeup } from './espionageProbeArrivalSchedulingService';

export type { EspionageProbeCompletionOutcome } from '@eonrover/shared';

/**
 * Internal-only wrapper for the one PostgreSQL-authoritative Probe lifecycle.
 * Future read fallback and worker code must call this same path rather than
 * interpreting a client or queue payload.
 */
export function settleCanonicalEspionageProbe(
  missionId: string,
  currentTime = new Date(),
): Promise<EspionageProbeCompletionOutcome> {
  return settlePersistedCanonicalEspionageProbe(prisma, missionId, currentTime, {
    scheduleReturnWakeup: scheduleEspionageProbeReturnWakeup,
  });
}
