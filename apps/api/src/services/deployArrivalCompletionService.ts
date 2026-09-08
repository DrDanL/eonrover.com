import {
  completeOwnedPlanetDeployArrival as completeDeployArrival,
  DeployArrivalCompletionOutcome,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';

export type { DeployArrivalCompletionOutcome };

/**
 * API wrapper for the shared authoritative completion service. This remains
 * internal; it exists for direct API integration coverage only.
 */
export async function completeOwnedPlanetDeployArrival(
  missionId: string,
  currentTime = new Date(),
): Promise<DeployArrivalCompletionOutcome> {
  return completeDeployArrival(prisma, missionId, currentTime);
}
