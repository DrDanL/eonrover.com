import { FleetMission, MissionStatus, MissionType } from '@prisma/client';
import {
  canonicalDeployShips,
  GALAXY_COORDINATE_BOUNDS,
  planCorvetteStrike,
  planFrigateStrike,
  ResourceAmounts,
  SHIPS,
} from '@eonrover/shared';
import { RequestHandler, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';
import { completeOwnedPlanetDeployArrival } from '../services/deployArrivalCompletionService';
import { DeployLaunchError, launchOwnedPlanetDeploy } from '../services/deployLaunchService';
import { completeCanonicalColonization } from '../services/colonizationCompletionService';
import { ColonizationLaunchError, launchCanonicalColonization } from '../services/colonizationLaunchService';
import { syncPlanetResources } from '../services/planetService';
import { settleCanonicalTransport } from '../services/transportCompletionService';
import { TransportLaunchError, launchCanonicalTransport } from '../services/transportLaunchService';
import { settleCanonicalEspionageProbe } from '../services/espionageProbeCompletionService';
import { EspionageProbeLaunchError, launchCanonicalEspionageProbe } from '../services/espionageProbeLaunchService';
import { settleCanonicalCorvetteStrike } from '../services/corvetteStrikeCompletionService';
import { CorvetteStrikeLaunchError, launchCanonicalCorvetteStrike } from '../services/corvetteStrikeLaunchService';
import { settleCanonicalFrigateStrike } from '../services/frigateStrikeCompletionService';
import { FrigateStrikeLaunchError, launchCanonicalFrigateStrike } from '../services/frigateStrikeLaunchService';
import { evaluateCombatTargetEligibility } from '../services/combatTargetEligibility';
import { getUniverseConfig } from '../services/gameConfig';

const router = Router();
router.use(requireAuth);

const deploymentQuerySchema = z.object({ originPlanetId: z.string().uuid() });
const deploymentLaunchSchema = z.object({
  originPlanetId: z.string().uuid(),
  destinationPlanetId: z.string().uuid(),
  speed: z.number().int(),
  ships: z.record(z.unknown()),
}).strict();
const colonizationQuerySchema = z.object({ originPlanetId: z.string().uuid() });
const colonizationLaunchSchema = z.object({
  originPlanetId: z.string().uuid(),
  targetSlot: z.number().int(),
}).strict();
const transportQuerySchema = z.object({ originPlanetId: z.string().uuid() });
const safeNonNegativeIntegerSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
const transportLaunchSchema = z.object({
  originPlanetId: z.string().uuid(),
  destinationPlanetId: z.string().uuid(),
  transporterQuantity: z.number().int().min(1).max(100).refine(Number.isSafeInteger),
  cargo: z.object({
    alloy: safeNonNegativeIntegerSchema,
    heliox: safeNonNegativeIntegerSchema,
    aether: safeNonNegativeIntegerSchema,
  }).strict(),
}).strict();
const espionageQuerySchema = z.object({ originPlanetId: z.string().uuid() });
const safeCoordinate = z.number().int().refine(Number.isSafeInteger);
const espionageLaunchSchema = z.object({
  originPlanetId: z.string().uuid(),
  target: z.object({
    galaxy: safeCoordinate,
    system: safeCoordinate,
    slot: safeCoordinate,
  }).strict(),
}).strict();
const strikeQuerySchema = z.object({ originPlanetId: z.string().uuid() });
const strikeLaunchSchema = z.object({
  originPlanetId: z.string().uuid(),
  target: z.object({
    galaxy: safeCoordinate,
    system: safeCoordinate,
    slot: safeCoordinate,
  }).strict(),
  corvettes: z.number().int().min(1).max(100).refine(Number.isSafeInteger),
}).strict();
const strictPositiveIntegerQuery = z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger);
const strikeCommandQuerySchema = z.object({
  originPlanetId: z.string().uuid(),
  galaxy: strictPositiveIntegerQuery,
  system: strictPositiveIntegerQuery,
  slot: strictPositiveIntegerQuery,
  corvettes: strictPositiveIntegerQuery.refine((value) => value >= 1 && value <= 100),
}).strict();
const frigateStrikeQuerySchema = z.object({ originPlanetId: z.string().uuid() }).strict();
const frigateStrikeCommandQuerySchema = z.object({
  originPlanetId: z.string().uuid(),
  galaxy: strictPositiveIntegerQuery,
  system: strictPositiveIntegerQuery,
  position: strictPositiveIntegerQuery,
  quantity: strictPositiveIntegerQuery.refine((value) => value >= 1 && value <= 100),
}).strict();
const frigateStrikeLaunchSchema = z.object({
  originPlanetId: z.string().uuid(),
  target: z.object({
    galaxy: safeCoordinate,
    system: safeCoordinate,
    position: safeCoordinate,
  }).strict(),
  quantity: z.number().int().min(1).max(100).refine(Number.isSafeInteger),
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

type ColonizationForPresentation = Pick<FleetMission,
  'originId' | 'targetGalaxy' | 'targetSystem' | 'targetSlot' | 'missionType' | 'status'
  | 'departedAt' | 'arrivesAt' | 'speedPercent' | 'colonizationAccountId' | 'colonizationTargetGalaxy'
  | 'colonizationTargetSystem' | 'colonizationTargetSlot' | 'colonizationShips'
  | 'colonizationFuelHeliox' | 'colonizationDurationSeconds' | 'colonizationCharacteristics'
  | 'colonizationStarterState' | 'createdPlanetId'
> & {
  origin: { id: string; ownerId: string; name: string; galaxy: number; system: number; slot: number } | null;
};

type SafeColonization = {
  origin: { id: string; name: string; coordinates: { galaxy: number; system: number; slot: number } };
  target: { coordinates: { galaxy: number; system: number; slot: number } };
  status: 'OUTBOUND';
  departedAt: Date;
  arrivesAt: Date;
  durationSeconds: number;
};

type SafeTransportPlanet = {
  id: string;
  name: string;
  coordinates: { galaxy: number; system: number; slot: number };
};

type SafeTransport = {
  id: string;
  origin: SafeTransportPlanet;
  destination: SafeTransportPlanet;
  transporterQuantity: number;
  remainingCargo: ResourceAmounts;
  phase: 'OUTBOUND' | 'AWAITING_DESTINATION_CAPACITY' | 'RETURNING';
  departedAt: Date;
  arrivesAt: Date;
  returnsAt: Date | null;
  capacityWaitMessage: string | null;
};

type TransportForPresentation = Pick<FleetMission,
  'id' | 'missionType' | 'status' | 'departedAt' | 'arrivesAt' | 'returnsAt'
  | 'transportOriginId' | 'transportDestinationId' | 'transportShips' | 'transportCargo'
  | 'transportRemainingCargo' | 'transportCapacity' | 'transportOutboundFuelHeliox'
  | 'transportReturnFuelHeliox' | 'transportTotalReservedFuelHeliox'
  | 'transportOutboundDurationSeconds' | 'transportReturnDurationSeconds' | 'transportPhase'
> & {
  transportOrigin: { id: string; ownerId: string; name: string; galaxy: number; system: number; slot: number } | null;
  transportDestination: { id: string; ownerId: string; name: string; galaxy: number; system: number; slot: number } | null;
};

type SafeEspionageMission = {
  phase: 'OUTBOUND' | 'RETURNING';
  target: { coordinates: { galaxy: number; system: number; slot: number } };
  departedAt: Date;
  arrivesAt: Date;
  returnsAt: Date;
  intelligenceReportReady: boolean;
};

type EspionageMissionForPresentation = Pick<FleetMission,
  'id' | 'originId' | 'targetId' | 'targetGalaxy' | 'targetSystem' | 'targetSlot'
  | 'missionType' | 'status' | 'speedPercent' | 'departedAt' | 'arrivesAt' | 'returnsAt'
  | 'espionageOriginPlanetId' | 'espionageTargetPlanetId'
  | 'espionageOriginAccountId' | 'espionageTargetAccountId'
  | 'espionageProbeShips' | 'espionageOutboundFuelHeliox' | 'espionageReturnFuelHeliox'
  | 'espionageOutboundDurationSeconds' | 'espionageReturnDurationSeconds' | 'espionageProbePhase'
> & {
  espionageOriginPlanet: { id: string; ownerId: string; galaxy: number; system: number; slot: number } | null;
  espionageTargetPlanet: { id: string; ownerId: string; galaxy: number; system: number; slot: number } | null;
  espionageProbeReport: { id: string } | null;
};

type SafeStrikeMission = {
  phase: 'OUTBOUND' | 'RETURNING';
  target: { coordinates: { galaxy: number; system: number; slot: number } };
  departedAt: Date;
  arrivesAt: Date;
  returnsAt: Date;
};

type StrikeMissionForPresentation = Pick<FleetMission,
  'id' | 'originId' | 'targetId' | 'targetGalaxy' | 'targetSystem' | 'targetSlot'
  | 'missionType' | 'status' | 'speedPercent' | 'departedAt' | 'arrivesAt' | 'returnsAt'
  | 'corvetteStrikeOriginPlanetId' | 'corvetteStrikeTargetPlanetId'
  | 'corvetteStrikeAttackerId' | 'corvetteStrikeDefenderId' | 'corvetteStrikeShips'
  | 'corvetteStrikeOutboundFuelHeliox' | 'corvetteStrikeReturnFuelHeliox'
  | 'corvetteStrikeOutboundDurationSeconds' | 'corvetteStrikeReturnDurationSeconds'
  | 'corvetteStrikePhase'
> & {
  corvetteStrikeOriginPlanet: { id: string; ownerId: string; galaxy: number; system: number; slot: number } | null;
  corvetteStrikeTargetPlanet: { id: string; ownerId: string; galaxy: number; system: number; slot: number } | null;
};

type SafeFrigateStrikeMission = {
  phase: 'OUTBOUND' | 'RETURNING';
  target: { coordinates: { galaxy: number; system: number; slot: number } };
  departedAt: Date;
  arrivesAt: Date;
  returnsAt: Date;
};

type FrigateStrikeMissionForPresentation = Pick<FleetMission,
  'id' | 'originId' | 'targetId' | 'targetGalaxy' | 'targetSystem' | 'targetSlot'
  | 'missionType' | 'status' | 'speedPercent' | 'departedAt' | 'arrivesAt' | 'returnsAt'
  | 'frigateStrikeOriginPlanetId' | 'frigateStrikeTargetPlanetId'
  | 'frigateStrikeAttackerId' | 'frigateStrikeDefenderId' | 'frigateStrikeShips'
  | 'frigateStrikeOutboundFuelHeliox' | 'frigateStrikeReturnFuelHeliox'
  | 'frigateStrikeOutboundDurationSeconds' | 'frigateStrikeReturnDurationSeconds'
  | 'frigateStrikePhase'
> & {
  frigateStrikeOriginPlanet: { id: string; ownerId: string; galaxy: number; system: number; slot: number } | null;
  frigateStrikeTargetPlanet: { id: string; ownerId: string; galaxy: number; system: number; slot: number } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalColonyManifest(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && value.colonyShip === 1;
}

function safeResourceSnapshot(value: unknown): ResourceAmounts | null {
  if (!isRecord(value) || Object.keys(value).length !== 3) return null;
  const { alloy, heliox, aether } = value;
  if (![alloy, heliox, aether].every((amount) => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0)) return null;
  return { alloy: alloy as number, heliox: heliox as number, aether: aether as number };
}

function safeTransporterManifest(value: unknown): { transporter: number } | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.transporter !== 'number') return null;
  if (!Number.isSafeInteger(value.transporter) || value.transporter < 1 || value.transporter > 100) return null;
  return { transporter: value.transporter };
}

function safeProbeManifest(value: unknown): { probe: 1 } | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || value.probe !== 1) return null;
  return { probe: 1 };
}

function safeCorvetteManifest(value: unknown): { corvette: number } | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.corvette !== 'number') return null;
  if (!Number.isSafeInteger(value.corvette) || value.corvette < 1 || value.corvette > 100) return null;
  return { corvette: value.corvette };
}

function safeFrigateManifest(value: unknown): { frigate: number } | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.frigate !== 'number') return null;
  if (!Number.isSafeInteger(value.frigate) || value.frigate < 1 || value.frigate > 100) return null;
  return { frigate: value.frigate };
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validColonizationSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 12;
}

function presentColonization(mission: ColonizationForPresentation, ownerId: string): SafeColonization | null {
  const origin = mission.origin;
  const durationSeconds = mission.colonizationDurationSeconds;
  const fuelHeliox = mission.colonizationFuelHeliox;
  const targetSlot = mission.colonizationTargetSlot;
  if (
    mission.missionType !== MissionType.COLONIZE
    || mission.status !== MissionStatus.OUTBOUND
    || !origin
    || origin.ownerId !== ownerId
    || mission.colonizationAccountId !== ownerId
    || mission.originId !== origin.id
    || !validColonizationSlot(targetSlot)
    || mission.colonizationTargetGalaxy !== origin.galaxy
    || mission.colonizationTargetSystem !== origin.system
    || mission.colonizationTargetSlot === origin.slot
    || mission.targetGalaxy !== mission.colonizationTargetGalaxy
    || mission.targetSystem !== mission.colonizationTargetSystem
    || mission.targetSlot !== mission.colonizationTargetSlot
    || mission.speedPercent !== 100
    || !isCanonicalColonyManifest(mission.colonizationShips)
    || typeof fuelHeliox !== 'number'
    || !Number.isInteger(fuelHeliox)
    || fuelHeliox < 0
    || typeof durationSeconds !== 'number'
    || !Number.isInteger(durationSeconds)
    || durationSeconds <= 0
    || !isRecord(mission.colonizationCharacteristics)
    || !isRecord(mission.colonizationStarterState)
    || mission.createdPlanetId !== null
    || !Number.isFinite(mission.departedAt.getTime())
    || !Number.isFinite(mission.arrivesAt.getTime())
    || mission.arrivesAt.getTime() - mission.departedAt.getTime() !== durationSeconds * 1_000
  ) return null;

  return {
    origin: {
      id: origin.id,
      name: origin.name,
      coordinates: { galaxy: origin.galaxy, system: origin.system, slot: origin.slot },
    },
    target: {
      coordinates: {
        galaxy: origin.galaxy,
        system: origin.system,
        slot: targetSlot,
      },
    },
    status: MissionStatus.OUTBOUND,
    departedAt: mission.departedAt,
    arrivesAt: mission.arrivesAt,
    durationSeconds,
  };
}

function colonizationSelect() {
  return {
    originId: true, targetGalaxy: true, targetSystem: true, targetSlot: true, speedPercent: true,
    missionType: true, status: true, departedAt: true, arrivesAt: true,
    colonizationAccountId: true, colonizationTargetGalaxy: true, colonizationTargetSystem: true,
    colonizationTargetSlot: true, colonizationShips: true, colonizationFuelHeliox: true,
    colonizationDurationSeconds: true, colonizationCharacteristics: true,
    colonizationStarterState: true, createdPlanetId: true,
    origin: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },
  } as const;
}

async function activeColonizationForAccount(accountId: string): Promise<ColonizationForPresentation | null> {
  return prisma.fleetMission.findFirst({
    where: {
      missionType: MissionType.COLONIZE,
      status: MissionStatus.OUTBOUND,
      colonizationAccountId: accountId,
      colonizationTargetGalaxy: { not: null },
      colonizationTargetSystem: { not: null },
      colonizationTargetSlot: { not: null },
    },
    orderBy: [{ arrivesAt: 'asc' }, { id: 'asc' }],
    select: colonizationSelect(),
  });
}

async function settleDueColonizationsForAccount(accountId: string, now: Date): Promise<boolean> {
  const dueMissions = await prisma.fleetMission.findMany({
    where: {
      missionType: MissionType.COLONIZE,
      status: MissionStatus.OUTBOUND,
      colonizationAccountId: accountId,
      colonizationTargetGalaxy: { not: null },
      colonizationTargetSystem: { not: null },
      colonizationTargetSlot: { not: null },
      arrivesAt: { lte: now },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const mission of dueMissions) {
    if (await completeCanonicalColonization(mission.id, now) === 'unavailable') return false;
  }
  return true;
}

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

function transportSelect() {
  return {
    id: true, missionType: true, status: true, departedAt: true, arrivesAt: true, returnsAt: true,
    transportOriginId: true, transportDestinationId: true, transportShips: true, transportCargo: true,
    transportRemainingCargo: true, transportCapacity: true, transportOutboundFuelHeliox: true,
    transportReturnFuelHeliox: true, transportTotalReservedFuelHeliox: true,
    transportOutboundDurationSeconds: true, transportReturnDurationSeconds: true, transportPhase: true,
    transportOrigin: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },
    transportDestination: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },
  } as const;
}

async function activeTransportForOrigin(originPlanetId: string): Promise<TransportForPresentation | null> {
  return prisma.fleetMission.findFirst({
    where: {
      missionType: MissionType.TRANSPORT,
      transportOriginId: originPlanetId,
      transportDestinationId: { not: null },
      status: { in: [MissionStatus.OUTBOUND, MissionStatus.RETURNING] },
      transportPhase: { in: ['OUTBOUND', 'AWAITING_DESTINATION_CAPACITY', 'RETURNING'] },
    },
    orderBy: [{ arrivesAt: 'asc' }, { id: 'asc' }],
    select: transportSelect(),
  });
}

function safeTransportPlanet(planet: NonNullable<TransportForPresentation['transportOrigin']>): SafeTransportPlanet {
  return {
    id: planet.id,
    name: planet.name,
    coordinates: { galaxy: planet.galaxy, system: planet.system, slot: planet.slot },
  };
}

function presentTransport(mission: TransportForPresentation, ownerId: string, originPlanetId: string): SafeTransport | null {
  const origin = mission.transportOrigin;
  const destination = mission.transportDestination;
  const ships = safeTransporterManifest(mission.transportShips);
  const originalCargo = safeResourceSnapshot(mission.transportCargo);
  const remainingCargo = safeResourceSnapshot(mission.transportRemainingCargo);
  const phase = mission.transportPhase;
  const capacity = mission.transportCapacity;
  const outboundFuel = mission.transportOutboundFuelHeliox;
  const returnFuel = mission.transportReturnFuelHeliox;
  const totalFuel = mission.transportTotalReservedFuelHeliox;
  const outboundDuration = mission.transportOutboundDurationSeconds;
  const returnDuration = mission.transportReturnDurationSeconds;
  if (
    mission.missionType !== MissionType.TRANSPORT
    || !origin || !destination
    || origin.id !== originPlanetId
    || mission.transportOriginId !== origin.id
    || mission.transportDestinationId !== destination.id
    || origin.ownerId !== ownerId || destination.ownerId !== ownerId
    || origin.id === destination.id
    || mission.status === MissionStatus.OUTBOUND && !['OUTBOUND', 'AWAITING_DESTINATION_CAPACITY'].includes(phase ?? '')
    || mission.status === MissionStatus.RETURNING && phase !== 'RETURNING'
    || (phase !== 'OUTBOUND' && phase !== 'AWAITING_DESTINATION_CAPACITY' && phase !== 'RETURNING')
    || !ships || !originalCargo || !remainingCargo
    || typeof capacity !== 'number' || !Number.isSafeInteger(capacity) || capacity < 0
    || typeof outboundFuel !== 'number' || !Number.isSafeInteger(outboundFuel) || outboundFuel < 0
    || typeof returnFuel !== 'number' || !Number.isSafeInteger(returnFuel) || returnFuel < 0
    || typeof totalFuel !== 'number' || !Number.isSafeInteger(totalFuel) || totalFuel < 0
    || typeof outboundDuration !== 'number' || !Number.isSafeInteger(outboundDuration) || outboundDuration <= 0
    || typeof returnDuration !== 'number' || !Number.isSafeInteger(returnDuration) || returnDuration <= 0
    || totalFuel !== outboundFuel + returnFuel
    || capacity < originalCargo.alloy + originalCargo.heliox + originalCargo.aether
    || !Number.isFinite(mission.departedAt.getTime()) || !Number.isFinite(mission.arrivesAt.getTime())
    || (mission.returnsAt !== null && !Number.isFinite(mission.returnsAt.getTime()))
    || phase === 'RETURNING' && (mission.returnsAt === null || remainingCargo.alloy !== 0 || remainingCargo.heliox !== 0 || remainingCargo.aether !== 0)
    || phase !== 'RETURNING' && (remainingCargo.alloy !== originalCargo.alloy || remainingCargo.heliox !== originalCargo.heliox || remainingCargo.aether !== originalCargo.aether)
  ) return null;

  return {
    id: mission.id,
    origin: safeTransportPlanet(origin),
    destination: safeTransportPlanet(destination),
    transporterQuantity: ships.transporter,
    remainingCargo,
    phase,
    departedAt: mission.departedAt,
    arrivesAt: mission.arrivesAt,
    returnsAt: mission.returnsAt,
    capacityWaitMessage: phase === 'AWAITING_DESTINATION_CAPACITY'
      ? 'Waiting for destination storage capacity before cargo can be delivered.'
      : null,
  };
}

async function settleTransportForOrigin(originPlanetId: string, currentTime: Date): Promise<boolean> {
  const active = await activeTransportForOrigin(originPlanetId);
  if (!active) return true;
  return (await settleCanonicalTransport(active.id, currentTime)) !== 'unavailable';
}

function espionageSelect() {
  return {
    id: true, originId: true, targetId: true, targetGalaxy: true, targetSystem: true, targetSlot: true,
    missionType: true, status: true, speedPercent: true, departedAt: true, arrivesAt: true, returnsAt: true,
    espionageOriginPlanetId: true, espionageTargetPlanetId: true,
    espionageOriginAccountId: true, espionageTargetAccountId: true,
    espionageProbeShips: true, espionageOutboundFuelHeliox: true, espionageReturnFuelHeliox: true,
    espionageOutboundDurationSeconds: true, espionageReturnDurationSeconds: true, espionageProbePhase: true,
    espionageOriginPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
    espionageTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
    espionageProbeReport: { select: { id: true } },
  } as const;
}

async function activeEspionageForOrigin(originPlanetId: string, accountId: string): Promise<EspionageMissionForPresentation | null> {
  return prisma.fleetMission.findFirst({
    where: {
      missionType: MissionType.ESPIONAGE,
      status: { in: [MissionStatus.OUTBOUND, MissionStatus.RETURNING] },
      espionageOriginPlanetId: originPlanetId,
      espionageOriginAccountId: accountId,
      espionageTargetPlanetId: { not: null },
      espionageTargetAccountId: { not: null },
      espionageProbePhase: { in: ['OUTBOUND', 'RETURNING'] },
    },
    orderBy: [{ arrivesAt: 'asc' }, { id: 'asc' }],
    select: espionageSelect(),
  });
}

function presentEspionage(mission: EspionageMissionForPresentation, accountId: string, originPlanetId: string): SafeEspionageMission | null {
  const origin = mission.espionageOriginPlanet;
  const target = mission.espionageTargetPlanet;
  const phase = mission.espionageProbePhase;
  const expectedStatus = phase === 'OUTBOUND' ? MissionStatus.OUTBOUND : MissionStatus.RETURNING;
  if (
    mission.missionType !== MissionType.ESPIONAGE
    || (phase !== 'OUTBOUND' && phase !== 'RETURNING')
    || mission.status !== expectedStatus
    || !origin || !target
    || origin.id !== originPlanetId || origin.ownerId !== accountId
    || target.ownerId === accountId
    || mission.originId !== origin.id || mission.targetId !== target.id
    || mission.espionageOriginPlanetId !== origin.id || mission.espionageTargetPlanetId !== target.id
    || mission.espionageOriginAccountId !== accountId || mission.espionageTargetAccountId !== target.ownerId
    || mission.targetGalaxy !== target.galaxy || mission.targetSystem !== target.system || mission.targetSlot !== target.slot
    || mission.speedPercent !== 100 || !safeProbeManifest(mission.espionageProbeShips)
    || !isSafeNonNegativeInteger(mission.espionageOutboundFuelHeliox)
    || !isSafeNonNegativeInteger(mission.espionageReturnFuelHeliox)
    || !isSafeNonNegativeInteger(mission.espionageOutboundDurationSeconds) || mission.espionageOutboundDurationSeconds <= 0
    || !isSafeNonNegativeInteger(mission.espionageReturnDurationSeconds) || mission.espionageReturnDurationSeconds <= 0
    || !Number.isFinite(mission.departedAt.getTime()) || !Number.isFinite(mission.arrivesAt.getTime())
    || !mission.returnsAt || !Number.isFinite(mission.returnsAt.getTime())
    || mission.arrivesAt.getTime() - mission.departedAt.getTime() !== mission.espionageOutboundDurationSeconds * 1_000
    || mission.returnsAt.getTime() - mission.arrivesAt.getTime() !== mission.espionageReturnDurationSeconds * 1_000
    || (phase === 'OUTBOUND' && mission.espionageProbeReport !== null)
    || (phase === 'RETURNING' && mission.espionageProbeReport === null)
  ) return null;

  return {
    phase,
    target: { coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot } },
    departedAt: mission.departedAt,
    arrivesAt: mission.arrivesAt,
    returnsAt: mission.returnsAt,
    intelligenceReportReady: mission.espionageProbeReport !== null,
  };
}

function sendEspionageLaunchError(res: Parameters<RequestHandler>[1], error: EspionageProbeLaunchError): void {
  switch (error.code) {
    case 'ORIGIN_NOT_OWNED':
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
      return;
    case 'INVALID_TARGET':
      sendError(res, 400, ERROR_CODES.BAD_REQUEST, error.message);
      return;
    case 'TARGET_UNAVAILABLE':
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Probe target not found');
      return;
    case 'TARGET_PROTECTED':
    case 'ESPIONAGE_IN_PROGRESS':
      sendError(res, 409, ERROR_CODES.CONFLICT, error.message);
      return;
    case 'MISSING_ESPIONAGE_TECHNOLOGY':
    case 'INSUFFICIENT_PROBES':
      sendError(res, 409, ERROR_CODES.CONFLICT, error.message);
      return;
    case 'INSUFFICIENT_HELIOX':
      sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, error.message);
      return;
    case 'ESPIONAGE_UNAVAILABLE':
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, error.message);
      return;
  }
}

function strikeSelect() {
  return {
    id: true, originId: true, targetId: true, targetGalaxy: true, targetSystem: true, targetSlot: true,
    missionType: true, status: true, speedPercent: true, departedAt: true, arrivesAt: true, returnsAt: true,
    corvetteStrikeOriginPlanetId: true, corvetteStrikeTargetPlanetId: true,
    corvetteStrikeAttackerId: true, corvetteStrikeDefenderId: true, corvetteStrikeShips: true,
    corvetteStrikeOutboundFuelHeliox: true, corvetteStrikeReturnFuelHeliox: true,
    corvetteStrikeOutboundDurationSeconds: true, corvetteStrikeReturnDurationSeconds: true,
    corvetteStrikePhase: true,
    corvetteStrikeOriginPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
    corvetteStrikeTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
  } as const;
}

async function activeStrikeForOrigin(originPlanetId: string, accountId: string): Promise<StrikeMissionForPresentation | null> {
  return prisma.fleetMission.findFirst({
    where: {
      missionType: MissionType.ATTACK,
      status: { in: [MissionStatus.OUTBOUND, MissionStatus.RETURNING] },
      corvetteStrikeOriginPlanetId: originPlanetId,
      corvetteStrikeAttackerId: accountId,
      corvetteStrikeTargetPlanetId: { not: null },
      corvetteStrikeDefenderId: { not: null },
      corvetteStrikePhase: { in: ['OUTBOUND', 'RETURNING'] },
    },
    orderBy: [{ arrivesAt: 'asc' }, { id: 'asc' }],
    select: strikeSelect(),
  });
}

function presentStrike(mission: StrikeMissionForPresentation, accountId: string, originPlanetId: string): SafeStrikeMission | null {
  const origin = mission.corvetteStrikeOriginPlanet;
  const target = mission.corvetteStrikeTargetPlanet;
  const phase = mission.corvetteStrikePhase;
  const expectedStatus = phase === 'OUTBOUND' ? MissionStatus.OUTBOUND : MissionStatus.RETURNING;
  if (
    mission.missionType !== MissionType.ATTACK
    || (phase !== 'OUTBOUND' && phase !== 'RETURNING')
    || mission.status !== expectedStatus
    || !origin || !target
    || origin.id !== originPlanetId || origin.ownerId !== accountId || target.ownerId === accountId
    || mission.originId !== origin.id || mission.targetId !== target.id
    || mission.corvetteStrikeOriginPlanetId !== origin.id || mission.corvetteStrikeTargetPlanetId !== target.id
    || mission.corvetteStrikeAttackerId !== accountId || mission.corvetteStrikeDefenderId !== target.ownerId
    || mission.targetGalaxy !== target.galaxy || mission.targetSystem !== target.system || mission.targetSlot !== target.slot
    || mission.speedPercent !== 100 || !safeCorvetteManifest(mission.corvetteStrikeShips)
    || !isSafeNonNegativeInteger(mission.corvetteStrikeOutboundFuelHeliox)
    || !isSafeNonNegativeInteger(mission.corvetteStrikeReturnFuelHeliox)
    || !isSafeNonNegativeInteger(mission.corvetteStrikeOutboundDurationSeconds) || mission.corvetteStrikeOutboundDurationSeconds <= 0
    || !isSafeNonNegativeInteger(mission.corvetteStrikeReturnDurationSeconds) || mission.corvetteStrikeReturnDurationSeconds <= 0
    || !Number.isFinite(mission.departedAt.getTime()) || !Number.isFinite(mission.arrivesAt.getTime())
    || !mission.returnsAt || !Number.isFinite(mission.returnsAt.getTime())
    || mission.arrivesAt.getTime() - mission.departedAt.getTime() !== mission.corvetteStrikeOutboundDurationSeconds * 1_000
  ) return null;
  return {
    phase,
    target: { coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot } },
    departedAt: mission.departedAt,
    arrivesAt: mission.arrivesAt,
    returnsAt: mission.returnsAt,
  };
}

function sendStrikeLaunchError(res: Parameters<RequestHandler>[1], error: CorvetteStrikeLaunchError): void {
  switch (error.code) {
    case 'ORIGIN_NOT_OWNED':
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
      return;
    case 'INVALID_TARGET':
      sendError(res, 400, ERROR_CODES.BAD_REQUEST, error.message);
      return;
    case 'TARGET_UNAVAILABLE':
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Strike target not found');
      return;
    case 'TARGET_PROTECTED':
    case 'STRIKE_IN_PROGRESS':
    case 'INSUFFICIENT_CORVETTES':
      sendError(res, 409, ERROR_CODES.CONFLICT, error.message);
      return;
    case 'INSUFFICIENT_HELIOX':
      sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, error.message);
      return;
    case 'STRIKE_UNAVAILABLE':
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, error.message);
      return;
  }
}

function frigateStrikeSelect() {
  return {
    id: true, originId: true, targetId: true, targetGalaxy: true, targetSystem: true, targetSlot: true,
    missionType: true, status: true, speedPercent: true, departedAt: true, arrivesAt: true, returnsAt: true,
    frigateStrikeOriginPlanetId: true, frigateStrikeTargetPlanetId: true,
    frigateStrikeAttackerId: true, frigateStrikeDefenderId: true, frigateStrikeShips: true,
    frigateStrikeOutboundFuelHeliox: true, frigateStrikeReturnFuelHeliox: true,
    frigateStrikeOutboundDurationSeconds: true, frigateStrikeReturnDurationSeconds: true,
    frigateStrikePhase: true,
    frigateStrikeOriginPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
    frigateStrikeTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
  } as const;
}

async function activeFrigateStrikeForOrigin(originPlanetId: string, accountId: string): Promise<FrigateStrikeMissionForPresentation | null> {
  return prisma.fleetMission.findFirst({
    where: {
      missionType: MissionType.ATTACK,
      status: { in: [MissionStatus.OUTBOUND, MissionStatus.RETURNING] },
      frigateStrikeOriginPlanetId: originPlanetId,
      frigateStrikeAttackerId: accountId,
      frigateStrikeTargetPlanetId: { not: null },
      frigateStrikeDefenderId: { not: null },
      frigateStrikePhase: { in: ['OUTBOUND', 'RETURNING'] },
    },
    orderBy: [{ arrivesAt: 'asc' }, { id: 'asc' }],
    select: frigateStrikeSelect(),
  });
}

function presentFrigateStrike(mission: FrigateStrikeMissionForPresentation, accountId: string, originPlanetId: string): SafeFrigateStrikeMission | null {
  const origin = mission.frigateStrikeOriginPlanet;
  const target = mission.frigateStrikeTargetPlanet;
  const phase = mission.frigateStrikePhase;
  const expectedStatus = phase === 'OUTBOUND' ? MissionStatus.OUTBOUND : MissionStatus.RETURNING;
  if (
    mission.missionType !== MissionType.ATTACK
    || (phase !== 'OUTBOUND' && phase !== 'RETURNING')
    || mission.status !== expectedStatus
    || !origin || !target
    || origin.id !== originPlanetId || origin.ownerId !== accountId || target.ownerId === accountId
    || mission.originId !== origin.id || mission.targetId !== target.id
    || mission.frigateStrikeOriginPlanetId !== origin.id || mission.frigateStrikeTargetPlanetId !== target.id
    || mission.frigateStrikeAttackerId !== accountId || mission.frigateStrikeDefenderId !== target.ownerId
    || mission.targetGalaxy !== target.galaxy || mission.targetSystem !== target.system || mission.targetSlot !== target.slot
    || mission.speedPercent !== 100 || !safeFrigateManifest(mission.frigateStrikeShips)
    || !isSafeNonNegativeInteger(mission.frigateStrikeOutboundFuelHeliox)
    || !isSafeNonNegativeInteger(mission.frigateStrikeReturnFuelHeliox)
    || !isSafeNonNegativeInteger(mission.frigateStrikeOutboundDurationSeconds) || mission.frigateStrikeOutboundDurationSeconds <= 0
    || !isSafeNonNegativeInteger(mission.frigateStrikeReturnDurationSeconds) || mission.frigateStrikeReturnDurationSeconds <= 0
    || !Number.isFinite(mission.departedAt.getTime()) || !Number.isFinite(mission.arrivesAt.getTime())
    || !mission.returnsAt || !Number.isFinite(mission.returnsAt.getTime())
    || mission.arrivesAt.getTime() - mission.departedAt.getTime() !== mission.frigateStrikeOutboundDurationSeconds * 1_000
  ) return null;
  return {
    phase,
    target: { coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot } },
    departedAt: mission.departedAt,
    arrivesAt: mission.arrivesAt,
    returnsAt: mission.returnsAt,
  };
}

async function settleFrigateStrikeForOrigin(originPlanetId: string, accountId: string, currentTime: Date): Promise<boolean> {
  const active = await activeFrigateStrikeForOrigin(originPlanetId, accountId);
  if (!active) return true;
  return (await settleCanonicalFrigateStrike(active.id, currentTime)) !== 'unavailable';
}

function sendFrigateStrikeLaunchError(res: Parameters<RequestHandler>[1], error: FrigateStrikeLaunchError): void {
  switch (error.code) {
    case 'ORIGIN_NOT_OWNED':
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
      return;
    case 'INVALID_TARGET':
      sendError(res, 400, ERROR_CODES.BAD_REQUEST, error.message);
      return;
    case 'TARGET_UNAVAILABLE':
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Strike target not found');
      return;
    case 'TARGET_PROTECTED':
    case 'STRIKE_IN_PROGRESS':
    case 'INSUFFICIENT_FRIGATES':
      sendError(res, 409, ERROR_CODES.CONFLICT, error.message);
      return;
    case 'INSUFFICIENT_HELIOX':
      sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, error.message);
      return;
    case 'STRIKE_UNAVAILABLE':
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, error.message);
      return;
  }
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

function sendTransportLaunchError(res: Parameters<RequestHandler>[1], error: TransportLaunchError): void {
  switch (error.code) {
    case 'ORIGIN_NOT_OWNED':
    case 'DESTINATION_NOT_OWNED':
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
      return;
    case 'IDENTICAL_PLANETS':
    case 'INVALID_TRANSPORT_INPUT':
      sendError(res, 400, ERROR_CODES.BAD_REQUEST, error.message);
      return;
    case 'INSUFFICIENT_TRANSPORTERS':
    case 'TRANSPORT_IN_PROGRESS':
      sendError(res, 409, ERROR_CODES.CONFLICT, error.message);
      return;
    case 'INSUFFICIENT_RESOURCES':
    case 'INSUFFICIENT_HELIOX':
      sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, error.message);
      return;
    case 'TRANSPORT_UNAVAILABLE':
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, error.message);
      return;
  }
}

router.get('/transports', asyncHandler(async (req, res) => {
  const parsed = transportQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const origin = await prisma.planet.findUnique({ where: { id: parsed.data.originPlanetId } });
  if (!origin || origin.ownerId !== req.user!.id) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }

  const now = new Date();
  if (!await settleTransportForOrigin(origin.id, now)) {
    sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Transport state could not be refreshed. Please try again.');
    return;
  }
  const [{ planet: settledOrigin }, transporters, destinations, active] = await Promise.all([
    syncPlanetResources(origin.id, now),
    prisma.ship.findUnique({
      where: { planetId_key: { planetId: origin.id, key: 'transporter' } },
      select: { count: true },
    }),
    prisma.planet.findMany({
      where: { ownerId: req.user!.id, id: { not: origin.id } },
      select: { id: true, name: true, galaxy: true, system: true, slot: true },
      orderBy: [{ galaxy: 'asc' }, { system: 'asc' }, { slot: 'asc' }, { id: 'asc' }],
    }),
    activeTransportForOrigin(origin.id),
  ]);

  res.json({
    selectedOrigin: {
      id: settledOrigin.id,
      name: settledOrigin.name,
      coordinates: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot },
      resources: { alloy: settledOrigin.alloy, heliox: settledOrigin.heliox, aether: settledOrigin.aether },
      transporterCount: transporters?.count ?? 0,
    },
    transporterCapacityPerShip: SHIPS.transporter.cargo,
    eligibleDestinations: destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      coordinates: { galaxy: destination.galaxy, system: destination.system, slot: destination.slot },
    })),
    activeTransport: active ? presentTransport(active, req.user!.id, origin.id) : null,
  });
}));

router.post('/transports', asyncHandler(async (req, res) => {
  const parsed = transportLaunchSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  try {
    const accepted = await launchCanonicalTransport({
      userId: req.user!.id,
      originPlanetId: parsed.data.originPlanetId,
      destinationPlanetId: parsed.data.destinationPlanetId,
      transporterQuantity: parsed.data.transporterQuantity,
      cargo: parsed.data.cargo,
    });
    const active = await activeTransportForOrigin(accepted.originPlanetId);
    const presentation = active ? presentTransport(active, req.user!.id, accepted.originPlanetId) : null;
    // Redis dispatch is intentionally absent from this response. The accepted
    // transaction is durable, and Stage 10B6 reconciliation repairs wake-ups.
    if (!presentation || presentation.id !== accepted.missionId) {
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Transport state could not be refreshed. Please try again.');
      return;
    }
    res.status(201).json({ activeTransport: presentation });
  } catch (error) {
    if (error instanceof TransportLaunchError) { sendTransportLaunchError(res, error); return; }
    throw error;
  }
}));

function sendColonizationLaunchError(res: Parameters<RequestHandler>[1], error: ColonizationLaunchError): void {
  switch (error.code) {
    case 'ORIGIN_NOT_OWNED':
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
      return;
    case 'INVALID_TARGET':
      sendError(res, 400, ERROR_CODES.BAD_REQUEST, error.message);
      return;
    case 'TARGET_OCCUPIED':
    case 'TARGET_RESERVED':
    case 'PLANET_LIMIT_REACHED':
    case 'COLONIZATION_IN_PROGRESS':
      sendError(res, 409, ERROR_CODES.CONFLICT, error.message);
      return;
    case 'INSUFFICIENT_COLONY_SHIPS':
      sendError(res, 409, ERROR_CODES.CONFLICT, error.message);
      return;
    case 'INSUFFICIENT_HELIOX':
      sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, error.message);
      return;
    case 'COLONIZATION_UNAVAILABLE':
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, error.message);
      return;
  }
}

router.get('/colonizations', asyncHandler(async (req, res) => {
  const parsed = colonizationQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const origin = await prisma.planet.findUnique({ where: { id: parsed.data.originPlanetId } });
  if (!origin || origin.ownerId !== req.user!.id) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }

  const now = new Date();
  if (!await settleDueColonizationsForAccount(req.user!.id, now)) {
    sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Colonisation state could not be refreshed. Please try again.');
    return;
  }

  const [{ planet: settledOrigin }, colonyShip, occupiedSlots, reservedSlots, active] = await Promise.all([
    syncPlanetResources(origin.id, now),
    prisma.ship.findUnique({
      where: { planetId_key: { planetId: origin.id, key: 'colonyShip' } },
      select: { count: true },
    }),
    prisma.planet.findMany({
      where: { galaxy: origin.galaxy, system: origin.system },
      select: { slot: true },
    }),
    prisma.fleetMission.findMany({
      where: {
        missionType: MissionType.COLONIZE,
        status: MissionStatus.OUTBOUND,
        colonizationAccountId: { not: null },
        colonizationTargetGalaxy: origin.galaxy,
        colonizationTargetSystem: origin.system,
        colonizationTargetSlot: { not: null },
      },
      select: { colonizationTargetSlot: true },
    }),
    activeColonizationForAccount(req.user!.id),
  ]);
  const unavailableSlots = new Set<number>([
    settledOrigin.slot,
    ...occupiedSlots.map(({ slot }) => slot),
    ...reservedSlots.flatMap(({ colonizationTargetSlot }) => validColonizationSlot(colonizationTargetSlot) ? [colonizationTargetSlot] : []),
  ]);
  const availableTargetSlots = Array.from({ length: 12 }, (_, index) => index + 1)
    .filter((slot) => !unavailableSlots.has(slot));

  res.json({
    selectedOrigin: {
      id: settledOrigin.id,
      name: settledOrigin.name,
      coordinates: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot },
      heliox: settledOrigin.heliox,
      availableColonyShips: colonyShip?.count ?? 0,
    },
    availableTargetSlots,
    activeColonization: active ? presentColonization(active, req.user!.id) : null,
  });
}));

router.post('/colonizations', asyncHandler(async (req, res) => {
  const parsed = colonizationLaunchSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  try {
    const accepted = await launchCanonicalColonization({
      accountId: req.user!.id,
      originPlanetId: parsed.data.originPlanetId,
      targetSlot: parsed.data.targetSlot,
    });
    const origin = await prisma.planet.findFirst({
      where: { id: accepted.originPlanetId, ownerId: req.user!.id },
      select: { id: true, name: true, galaxy: true, system: true, slot: true },
    });
    if (!origin) {
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Colonisation state could not be refreshed. Please try again.');
      return;
    }
    res.status(201).json({
      activeColonization: {
        origin: {
          id: origin.id,
          name: origin.name,
          coordinates: { galaxy: origin.galaxy, system: origin.system, slot: origin.slot },
        },
        target: { coordinates: accepted.target },
        status: MissionStatus.OUTBOUND,
        departedAt: accepted.departedAt,
        arrivesAt: accepted.arrivesAt,
        durationSeconds: accepted.durationSeconds,
      },
    });
  } catch (error) {
    if (error instanceof ColonizationLaunchError) { sendColonizationLaunchError(res, error); return; }
    throw error;
  }
}));

router.get('/strikes', asyncHandler(async (req, res) => {
  const parsed = strikeQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const origin = await prisma.planet.findUnique({ where: { id: parsed.data.originPlanetId } });
  if (!origin || origin.ownerId !== req.user!.id) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }

  const now = new Date();
  const pending = await activeStrikeForOrigin(origin.id, req.user!.id);
  if (pending) {
    const completion = await settleCanonicalCorvetteStrike(pending.id, now);
    if (completion === 'unavailable') {
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Strike state could not be refreshed. Please try again.');
      return;
    }
  }

  const [{ planet: settledOrigin }, corvettes, active] = await Promise.all([
    syncPlanetResources(origin.id, now),
    prisma.ship.findUnique({
      where: { planetId_key: { planetId: origin.id, key: 'corvette' } },
      select: { count: true },
    }),
    activeStrikeForOrigin(origin.id, req.user!.id),
  ]);
  res.json({
    selectedOrigin: {
      coordinates: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot },
      heliox: settledOrigin.heliox,
      availableCorvettes: corvettes?.count ?? 0,
    },
    activeStrike: active ? presentStrike(active, req.user!.id, origin.id) : null,
  });
}));

router.post('/strikes', asyncHandler(async (req, res) => {
  const parsed = strikeLaunchSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  try {
    const accepted = await launchCanonicalCorvetteStrike({
      userId: req.user!.id,
      originPlanetId: parsed.data.originPlanetId,
      target: parsed.data.target,
      quantity: parsed.data.corvettes,
    });
    const active = await activeStrikeForOrigin(accepted.originPlanetId, req.user!.id);
    const presentation = active ? presentStrike(active, req.user!.id, accepted.originPlanetId) : null;
    // A completed PostgreSQL reservation remains accepted even when Redis could
    // not receive its post-commit wake-up. Reconciliation owns that recovery.
    if (!presentation) {
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Strike state could not be refreshed. Please try again.');
      return;
    }
    res.status(201).json({ activeStrike: presentation });
  } catch (error) {
    if (error instanceof CorvetteStrikeLaunchError) { sendStrikeLaunchError(res, error); return; }
    throw error;
  }
}));

router.get('/strikes/command', asyncHandler(async (req, res) => {
  const parsed = strikeCommandQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const origin = await prisma.planet.findUnique({ where: { id: parsed.data.originPlanetId } });
  if (!origin || origin.ownerId !== req.user!.id) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }
  const now = new Date();
  const target = { galaxy: parsed.data.galaxy, system: parsed.data.system, slot: parsed.data.slot };
  const [{ planet: settledOrigin }, corvettes, active, candidate, attacker, config] = await Promise.all([
    syncPlanetResources(origin.id, now),
    prisma.ship.findUnique({ where: { planetId_key: { planetId: origin.id, key: 'corvette' } }, select: { count: true } }),
    activeStrikeForOrigin(origin.id, req.user!.id),
    prisma.planet.findUnique({ where: { galaxy_system_slot: target }, select: { id: true, ownerId: true, galaxy: true, system: true, slot: true, owner: { select: { id: true, status: true, emailVerifiedAt: true, protectedUntil: true } } } }),
    prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, status: true, emailVerifiedAt: true } }),
    getUniverseConfig(),
  ]);
  const withinBounds = target.galaxy >= GALAXY_COORDINATE_BOUNDS.galaxy.min
    && target.galaxy <= GALAXY_COORDINATE_BOUNDS.galaxy.max
    && target.system >= GALAXY_COORDINATE_BOUNDS.system.min
    && target.system <= GALAXY_COORDINATE_BOUNDS.system.max
    && target.slot >= GALAXY_COORDINATE_BOUNDS.slot.min
    && target.slot <= GALAXY_COORDINATE_BOUNDS.slot.max;
  const targetEligibility = withinBounds
    ? evaluateCombatTargetEligibility({ attacker, origin: settledOrigin, requestedTarget: target, target: candidate, now })
    : { eligible: false, code: 'INVALID_TARGET' as const };
  let estimate: { durationSeconds: number; fuelHeliox: number } | null = null;
  if (targetEligibility.code !== 'INVALID_TARGET') {
    try {
      const plan = planCorvetteStrike({ origin: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot }, target, quantity: parsed.data.corvettes, fleetSpeed: config.fleetSpeed });
      estimate = { durationSeconds: plan.outboundDurationSeconds, fuelHeliox: plan.outboundFuelHeliox + plan.returnFuelHeliox };
    } catch { /* Invalid planner inputs remain a safe command rejection below. */ }
  }
  let code: 'ELIGIBLE' | 'INVALID_TARGET' | 'TARGET_UNAVAILABLE' | 'TARGET_PROTECTED' | 'STRIKE_IN_PROGRESS' | 'INSUFFICIENT_CORVETTES' | 'INSUFFICIENT_HELIOX' = targetEligibility.code;
  if (code === 'ELIGIBLE' && active) code = 'STRIKE_IN_PROGRESS';
  else if (code === 'ELIGIBLE' && (corvettes?.count ?? 0) < parsed.data.corvettes) code = 'INSUFFICIENT_CORVETTES';
  else if (code === 'ELIGIBLE' && (!estimate || settledOrigin.heliox < estimate.fuelHeliox)) code = 'INSUFFICIENT_HELIOX';
  res.json({
    selectedOrigin: { coordinates: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot }, heliox: settledOrigin.heliox, availableCorvettes: corvettes?.count ?? 0, maximumQuantity: Math.min(100, corvettes?.count ?? 0) },
    target: { coordinates: target },
    quantity: parsed.data.corvettes,
    eligibility: { eligible: code === 'ELIGIBLE', code },
    estimate,
    affordability: estimate ? { requiredHeliox: estimate.fuelHeliox, affordable: settledOrigin.heliox >= estimate.fuelHeliox } : null,
    activeStrike: active ? presentStrike(active, req.user!.id, origin.id) : null,
  });
}));

router.get('/frigate-strikes', asyncHandler(async (req, res) => {
  const parsed = frigateStrikeQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const origin = await prisma.planet.findUnique({ where: { id: parsed.data.originPlanetId } });
  if (!origin || origin.ownerId !== req.user!.id) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }

  const now = new Date();
  if (!await settleFrigateStrikeForOrigin(origin.id, req.user!.id, now)) {
    sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Frigate strike state could not be refreshed. Please try again.');
    return;
  }
  const [{ planet: settledOrigin }, frigates, active] = await Promise.all([
    syncPlanetResources(origin.id, now),
    prisma.ship.findUnique({
      where: { planetId_key: { planetId: origin.id, key: 'frigate' } },
      select: { count: true },
    }),
    activeFrigateStrikeForOrigin(origin.id, req.user!.id),
  ]);
  res.json({
    selectedOrigin: {
      coordinates: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot },
      heliox: settledOrigin.heliox,
      availableFrigates: frigates?.count ?? 0,
      maximumQuantity: Math.min(100, frigates?.count ?? 0),
    },
    activeFrigateStrike: active ? presentFrigateStrike(active, req.user!.id, origin.id) : null,
  });
}));

router.get('/frigate-strikes/command', asyncHandler(async (req, res) => {
  const parsed = frigateStrikeCommandQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const origin = await prisma.planet.findUnique({ where: { id: parsed.data.originPlanetId } });
  if (!origin || origin.ownerId !== req.user!.id) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }

  const now = new Date();
  if (!await settleFrigateStrikeForOrigin(origin.id, req.user!.id, now)) {
    sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Frigate strike state could not be refreshed. Please try again.');
    return;
  }
  const target = { galaxy: parsed.data.galaxy, system: parsed.data.system, slot: parsed.data.position };
  const [{ planet: settledOrigin }, frigates, active, candidate, attacker, config] = await Promise.all([
    syncPlanetResources(origin.id, now),
    prisma.ship.findUnique({
      where: { planetId_key: { planetId: origin.id, key: 'frigate' } },
      select: { count: true },
    }),
    activeFrigateStrikeForOrigin(origin.id, req.user!.id),
    prisma.planet.findUnique({
      where: { galaxy_system_slot: target },
      select: { id: true, ownerId: true, galaxy: true, system: true, slot: true, owner: { select: { id: true, status: true, emailVerifiedAt: true, protectedUntil: true } } },
    }),
    prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, status: true, emailVerifiedAt: true } }),
    getUniverseConfig(),
  ]);
  const withinBounds = target.galaxy >= GALAXY_COORDINATE_BOUNDS.galaxy.min
    && target.galaxy <= GALAXY_COORDINATE_BOUNDS.galaxy.max
    && target.system >= GALAXY_COORDINATE_BOUNDS.system.min
    && target.system <= GALAXY_COORDINATE_BOUNDS.system.max
    && target.slot >= GALAXY_COORDINATE_BOUNDS.slot.min
    && target.slot <= GALAXY_COORDINATE_BOUNDS.slot.max;
  let estimate: { durationSeconds: number; fuelHeliox: number } | null = null;
  if (withinBounds && settledOrigin.galaxy === target.galaxy
    && (settledOrigin.system !== target.system || settledOrigin.slot !== target.slot)) {
    try {
      const plan = planFrigateStrike({
        origin: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot },
        target,
        quantity: parsed.data.quantity,
        fleetSpeed: config.fleetSpeed,
      });
      estimate = {
        durationSeconds: plan.outboundDurationSeconds,
        fuelHeliox: plan.outboundFuelHeliox + plan.returnFuelHeliox,
      };
    } catch {
      // Invalid client coordinates are represented by the command eligibility
      // result below; planner details are not a source of gameplay state.
    }
  }

  const targetEligibility = withinBounds
    ? evaluateCombatTargetEligibility({ attacker, origin: settledOrigin, requestedTarget: target, target: candidate, now })
    : { eligible: false, code: 'INVALID_TARGET' as const };
  let code: 'ELIGIBLE' | 'INVALID_TARGET' | 'TARGET_UNAVAILABLE' | 'TARGET_PROTECTED' | 'STRIKE_IN_PROGRESS' | 'INSUFFICIENT_FRIGATES' | 'INSUFFICIENT_HELIOX' = targetEligibility.code;
  if (code === 'ELIGIBLE' && active) {
    code = 'STRIKE_IN_PROGRESS';
  } else if (code === 'ELIGIBLE' && (frigates?.count ?? 0) < parsed.data.quantity) {
    code = 'INSUFFICIENT_FRIGATES';
  } else if (code === 'ELIGIBLE' && (!estimate || settledOrigin.heliox < estimate.fuelHeliox)) {
    code = 'INSUFFICIENT_HELIOX';
  }
  res.json({
    selectedOrigin: {
      coordinates: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot },
      heliox: settledOrigin.heliox,
      availableFrigates: frigates?.count ?? 0,
      maximumQuantity: Math.min(100, frigates?.count ?? 0),
    },
    target: { coordinates: target },
    quantity: parsed.data.quantity,
    eligibility: { eligible: code === 'ELIGIBLE', code },
    estimate,
    affordability: estimate ? { requiredHeliox: estimate.fuelHeliox, affordable: settledOrigin.heliox >= estimate.fuelHeliox } : null,
    activeFrigateStrike: active ? presentFrigateStrike(active, req.user!.id, origin.id) : null,
  });
}));

router.post('/frigate-strikes', asyncHandler(async (req, res) => {
  const parsed = frigateStrikeLaunchSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  try {
    const accepted = await launchCanonicalFrigateStrike({
      userId: req.user!.id,
      originPlanetId: parsed.data.originPlanetId,
      target: {
        galaxy: parsed.data.target.galaxy,
        system: parsed.data.target.system,
        slot: parsed.data.target.position,
      },
      quantity: parsed.data.quantity,
    });
    const active = await activeFrigateStrikeForOrigin(accepted.originPlanetId, req.user!.id);
    const presentation = active ? presentFrigateStrike(active, req.user!.id, accepted.originPlanetId) : null;
    // A completed PostgreSQL reservation remains accepted even when its
    // best-effort Redis wake-up fails; the reconciler owns recovery.
    if (!presentation) {
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Frigate strike state could not be refreshed. Please try again.');
      return;
    }
    res.status(201).json({ activeFrigateStrike: presentation });
  } catch (error) {
    if (error instanceof FrigateStrikeLaunchError) { sendFrigateStrikeLaunchError(res, error); return; }
    throw error;
  }
}));

router.get('/espionage', asyncHandler(async (req, res) => {
  const parsed = espionageQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const origin = await prisma.planet.findUnique({ where: { id: parsed.data.originPlanetId } });
  if (!origin || origin.ownerId !== req.user!.id) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }

  const now = new Date();
  const pending = await activeEspionageForOrigin(origin.id, req.user!.id);
  if (pending) {
    const completion = await settleCanonicalEspionageProbe(pending.id, now);
    if (completion === 'unavailable') {
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Probe state could not be refreshed. Please try again.');
      return;
    }
  }

  const [{ planet: settledOrigin }, probes, technology, active] = await Promise.all([
    syncPlanetResources(origin.id, now),
    prisma.ship.findUnique({
      where: { planetId_key: { planetId: origin.id, key: 'probe' } },
      select: { count: true },
    }),
    prisma.research.findUnique({
      where: { userId_key: { userId: req.user!.id, key: 'espionageTech' } },
      select: { level: true },
    }),
    activeEspionageForOrigin(origin.id, req.user!.id),
  ]);
  res.json({
    selectedOrigin: {
      coordinates: { galaxy: settledOrigin.galaxy, system: settledOrigin.system, slot: settledOrigin.slot },
      heliox: settledOrigin.heliox,
      availableProbes: probes?.count ?? 0,
      espionageTechnologyLevel: technology?.level ?? 0,
    },
    activeEspionage: active ? presentEspionage(active, req.user!.id, origin.id) : null,
  });
}));

router.post('/espionage', asyncHandler(async (req, res) => {
  const parsed = espionageLaunchSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  try {
    const accepted = await launchCanonicalEspionageProbe({
      userId: req.user!.id,
      originPlanetId: parsed.data.originPlanetId,
      target: parsed.data.target,
    });
    const active = await activeEspionageForOrigin(accepted.originPlanetId, req.user!.id);
    const presentation = active ? presentEspionage(active, req.user!.id, accepted.originPlanetId) : null;
    // An accepted reservation is durable even if its post-commit wake-up was
    // unavailable. Reconciliation owns recovery and the response exposes no
    // Redis/BullMQ outcome or identity.
    if (!presentation) {
      sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Probe state could not be refreshed. Please try again.');
      return;
    }
    res.status(201).json({ activeEspionage: presentation });
  } catch (error) {
    if (error instanceof EspionageProbeLaunchError) { sendEspionageLaunchError(res, error); return; }
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
