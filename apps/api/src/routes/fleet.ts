import { FleetMission, MissionStatus, MissionType } from '@prisma/client';
import { canonicalDeployShips } from '@eonrover/shared';
import { RequestHandler, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';
import { completeOwnedPlanetDeployArrival } from '../services/deployArrivalCompletionService';
import { DeployLaunchError, launchOwnedPlanetDeploy } from '../services/deployLaunchService';
import { syncPlanetResources } from '../services/planetService';

const router = Router();
router.use(requireAuth);

const deploymentQuerySchema = z.object({ originPlanetId: z.string().uuid() });
const deploymentLaunchSchema = z.object({
  originPlanetId: z.string().uuid(),
  destinationPlanetId: z.string().uuid(),
  speed: z.number().int(),
  ships: z.record(z.unknown()),
}).strict();

// Deploy planning accepts integer percentages from 10 through 100. These are
// the presentation choices for the later Fleet command screen; the server
// remains the authority for validating the submitted speed and all timing.
const DEPLOY_SPEED_OPTIONS = [10, 25, 50, 75, 100] as const;

type SafeDeployment = {
  id: string;
  destination: { id: string; name: string; coordinates: { galaxy: number; system: number; slot: number } };
  ships: Record<string, number>;
  fuelHeliox: number;
  durationSeconds: number;
  departedAt: Date;
  arrivesAt: Date;
  status: MissionStatus;
};

type DeploymentForPresentation = Pick<FleetMission,
  'id' | 'originId' | 'targetId' | 'targetGalaxy' | 'targetSystem' | 'targetSlot'
  | 'missionType' | 'status' | 'departedAt' | 'arrivesAt' | 'deployOriginId'
  | 'deployDestinationId' | 'deployShips' | 'deployFuelHeliox' | 'deployDurationSeconds'
> & {
  deployDestination: { id: string; ownerId: string; name: string; galaxy: number; system: number; slot: number } | null;
};

function presentDeployment(mission: DeploymentForPresentation, ownerId: string, originPlanetId: string): SafeDeployment | null {
  const fuelHeliox = mission.deployFuelHeliox;
  const durationSeconds = mission.deployDurationSeconds;
  if (
    mission.missionType !== MissionType.DEPLOY
    || mission.status !== MissionStatus.OUTBOUND
    || mission.originId !== originPlanetId
    || mission.deployOriginId !== originPlanetId
    || !mission.deployDestinationId
    || mission.targetId !== mission.deployDestinationId
    || !mission.deployDestination
    || mission.deployDestination.id !== mission.deployDestinationId
    || mission.deployDestination.ownerId !== ownerId
    || mission.deployDestination.id === originPlanetId
    || mission.targetGalaxy !== mission.deployDestination.galaxy
    || mission.targetSystem !== mission.deployDestination.system
    || mission.targetSlot !== mission.deployDestination.slot
    || fuelHeliox === null
    || !Number.isInteger(fuelHeliox)
    || fuelHeliox < 0
    || durationSeconds === null
    || !Number.isInteger(durationSeconds)
    || durationSeconds <= 0
    || !Number.isFinite(mission.departedAt.getTime())
    || !Number.isFinite(mission.arrivesAt.getTime())
  ) return null;

  try {
    return {
      id: mission.id,
      destination: {
        id: mission.deployDestination.id,
        name: mission.deployDestination.name,
        coordinates: {
          galaxy: mission.deployDestination.galaxy,
          system: mission.deployDestination.system,
          slot: mission.deployDestination.slot,
        },
      },
      ships: canonicalDeployShips(mission.deployShips),
      fuelHeliox,
      durationSeconds,
      departedAt: mission.departedAt,
      arrivesAt: mission.arrivesAt,
      status: mission.status,
    };
  } catch {
    return null;
  }
}

async function activeDeploymentForOrigin(originPlanetId: string, ownerId: string): Promise<DeploymentForPresentation | null> {
  return prisma.fleetMission.findFirst({
    where: { originId: originPlanetId, missionType: MissionType.DEPLOY, status: MissionStatus.OUTBOUND },
    orderBy: [{ arrivesAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, originId: true, targetId: true, targetGalaxy: true, targetSystem: true, targetSlot: true,
      missionType: true, status: true, departedAt: true, arrivesAt: true,
      deployOriginId: true, deployDestinationId: true, deployShips: true,
      deployFuelHeliox: true, deployDurationSeconds: true,
      deployDestination: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },
    },
  });
}

function sendLaunchError(res: Parameters<RequestHandler>[1], error: DeployLaunchError): void {
  switch (error.code) {
    case 'ORIGIN_NOT_OWNED':
    case 'DESTINATION_NOT_OWNED':
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
      return;
    case 'IDENTICAL_PLANETS':
    case 'INVALID_DEPLOY_INPUT':
      sendError(res, 400, ERROR_CODES.BAD_REQUEST, error.message);
      return;
    case 'INSUFFICIENT_SHIPS':
      sendError(res, 409, ERROR_CODES.CONFLICT, error.message);
      return;
    case 'INSUFFICIENT_HELIOX':
      sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, error.message);
      return;
    case 'DEPLOYMENT_IN_PROGRESS':
      sendError(res, 409, ERROR_CODES.CONFLICT, error.message);
      return;
    case 'DEPLOYMENT_UNAVAILABLE':
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, error.message);
      return;
  }
}

router.get('/deployments', asyncHandler(async (req, res) => {
  const parsed = deploymentQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const origin = await prisma.planet.findUnique({ where: { id: parsed.data.originPlanetId } });
  if (!origin || origin.ownerId !== req.user!.id) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }

  const now = new Date();
  const pending = await activeDeploymentForOrigin(origin.id, req.user!.id);
  if (pending && pending.arrivesAt <= now) {
    const completion = await completeOwnedPlanetDeployArrival(pending.id, now);
    if (completion === 'unavailable') {
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Deploy state could not be refreshed. Please try again.');
      return;
    }
  }

  const [{ planet: settledOrigin }, ships, destinations, active] = await Promise.all([
    syncPlanetResources(origin.id, now),
    prisma.ship.findMany({ where: { planetId: origin.id }, select: { key: true, count: true }, orderBy: { key: 'asc' } }),
    prisma.planet.findMany({
      where: { ownerId: req.user!.id, id: { not: origin.id } },
      select: { id: true, name: true, galaxy: true, system: true, slot: true },
      orderBy: [{ galaxy: 'asc' }, { system: 'asc' }, { slot: 'asc' }, { id: 'asc' }],
    }),
    activeDeploymentForOrigin(origin.id, req.user!.id),
  ]);

  res.json({
    selectedOrigin: {
      id: settledOrigin.id,
      name: settledOrigin.name,
      coordinates: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot },
      heliox: settledOrigin.heliox,
      ships,
    },
    eligibleDestinations: destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      coordinates: { galaxy: destination.galaxy, system: destination.system, slot: destination.slot },
    })),
    supportedSpeedOptions: DEPLOY_SPEED_OPTIONS,
    activeDeployment: active ? presentDeployment(active, req.user!.id, origin.id) : null,
  });
}));

router.post('/deployments', asyncHandler(async (req, res) => {
  const parsed = deploymentLaunchSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  try {
    const accepted = await launchOwnedPlanetDeploy({
      accountId: req.user!.id,
      originPlanetId: parsed.data.originPlanetId,
      destinationPlanetId: parsed.data.destinationPlanetId,
      speedPercent: parsed.data.speed,
      ships: parsed.data.ships,
    });
    const destination = await prisma.planet.findFirst({
      where: { id: accepted.destinationPlanetId, ownerId: req.user!.id },
      select: { id: true, name: true, galaxy: true, system: true, slot: true },
    });
    // The launch transaction verified this destination. Preserve a safe
    // availability boundary if an unexpected concurrent ownership change is
    // observed before its response can be projected.
    if (!destination) { sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Deploy state could not be refreshed. Please try again.'); return; }
    res.status(201).json({
      activeDeployment: {
        id: accepted.missionId,
        destination: {
          id: destination.id,
          name: destination.name,
          coordinates: { galaxy: destination.galaxy, system: destination.system, slot: destination.slot },
        },
        ships: accepted.ships,
        fuelHeliox: accepted.fuelHeliox,
        durationSeconds: accepted.durationSeconds,
        departedAt: accepted.departedAt,
        arrivesAt: accepted.arrivesAt,
        status: MissionStatus.OUTBOUND,
      },
    });
  } catch (error) {
    if (error instanceof DeployLaunchError) { sendLaunchError(res, error); return; }
    throw error;
  }
}));

// The generic prototype mutates fleets without authoritative lifecycle
// safeguards. Keep its authenticated surface deliberately unavailable until
// the bounded deploy lifecycle replaces it.
const unavailable: RequestHandler = (_req, res) => {
  sendError(res, 503, ERROR_CODES.FLEET_MISSIONS_UNAVAILABLE, 'Fleet missions are temporarily unavailable.');
};

router.get('/', unavailable);
router.post('/', unavailable);
router.post('/:id/recall', unavailable);

export default router;
