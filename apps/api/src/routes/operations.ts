import { MissionStatus, MissionType, Prisma } from '@prisma/client';
import { canonicalDeployShips } from '@eonrover/shared';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

const router = Router();
router.use(requireAuth);

/** The response is deliberately bounded even if a future family loosens its active-slot invariant. */
const OPERATION_CANDIDATE_LIMIT = 100;
const OPERATION_RESPONSE_LIMIT = 50;

type Coordinates = { galaxy: number; system: number; slot: number };
type OperationPhase = 'OUTBOUND' | 'RETURNING' | 'AWAITING_DESTINATION_CAPACITY';
type OperationType = 'DEPLOY' | 'COLONIZATION' | 'TRANSPORT' | 'ESPIONAGE_PROBE' | 'CORVETTE_STRIKE' | 'FRIGATE_STRIKE';

type Operation = {
  missionType: OperationType;
  phase: OperationPhase;
  direction: 'OUTBOUND' | 'RETURNING';
  origin: { name: string; coordinates: Coordinates };
  destination: Coordinates;
  manifest: Record<string, number>;
  cargo: { alloy: number; heliox: number; aether: number } | null;
  departedAt: Date;
  nextEventAt: Date | null;
};

const operationSelect = {
  missionType: true,
  status: true,
  originId: true,
  targetId: true,
  targetGalaxy: true,
  targetSystem: true,
  targetSlot: true,
  departedAt: true,
  arrivesAt: true,
  returnsAt: true,
  speedPercent: true,

  deployOriginId: true,
  deployDestinationId: true,
  deployShips: true,
  deployFuelHeliox: true,
  deployDurationSeconds: true,
  deployOrigin: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },
  deployDestination: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },

  colonizationAccountId: true,
  colonizationTargetGalaxy: true,
  colonizationTargetSystem: true,
  colonizationTargetSlot: true,
  colonizationShips: true,
  colonizationFuelHeliox: true,
  colonizationDurationSeconds: true,
  colonizationCharacteristics: true,
  colonizationStarterState: true,
  createdPlanetId: true,
  origin: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },

  transportOriginId: true,
  transportDestinationId: true,
  transportShips: true,
  transportCargo: true,
  transportRemainingCargo: true,
  transportCapacity: true,
  transportOutboundFuelHeliox: true,
  transportReturnFuelHeliox: true,
  transportTotalReservedFuelHeliox: true,
  transportOutboundDurationSeconds: true,
  transportReturnDurationSeconds: true,
  transportPhase: true,
  transportOrigin: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },
  transportDestination: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },

  espionageOriginPlanetId: true,
  espionageTargetPlanetId: true,
  espionageOriginAccountId: true,
  espionageTargetAccountId: true,
  espionageProbeShips: true,
  espionageOutboundFuelHeliox: true,
  espionageReturnFuelHeliox: true,
  espionageOutboundDurationSeconds: true,
  espionageReturnDurationSeconds: true,
  espionageProbePhase: true,
  espionageOriginPlanet: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },
  espionageTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },

  corvetteStrikeOriginPlanetId: true,
  corvetteStrikeTargetPlanetId: true,
  corvetteStrikeAttackerId: true,
  corvetteStrikeDefenderId: true,
  corvetteStrikeShips: true,
  corvetteStrikeOutboundFuelHeliox: true,
  corvetteStrikeReturnFuelHeliox: true,
  corvetteStrikeOutboundDurationSeconds: true,
  corvetteStrikeReturnDurationSeconds: true,
  corvetteStrikePhase: true,
  corvetteStrikeOriginPlanet: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },
  corvetteStrikeTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },

  frigateStrikeOriginPlanetId: true,
  frigateStrikeTargetPlanetId: true,
  frigateStrikeAttackerId: true,
  frigateStrikeDefenderId: true,
  frigateStrikeShips: true,
  frigateStrikeOutboundFuelHeliox: true,
  frigateStrikeReturnFuelHeliox: true,
  frigateStrikeOutboundDurationSeconds: true,
  frigateStrikeReturnDurationSeconds: true,
  frigateStrikePhase: true,
  frigateStrikeOriginPlanet: { select: { id: true, ownerId: true, name: true, galaxy: true, system: true, slot: true } },
  frigateStrikeTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
} satisfies Prisma.FleetMissionSelect;

type OperationMission = Prisma.FleetMissionGetPayload<{ select: typeof operationSelect }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteTime(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validCoordinate(value: Coordinates): boolean {
  return Number.isSafeInteger(value.galaxy) && Number.isSafeInteger(value.system) && Number.isSafeInteger(value.slot)
    && value.galaxy > 0 && value.system > 0 && value.slot >= 1 && value.slot <= 12;
}

function coordinate(planet: { galaxy: number; system: number; slot: number }): Coordinates {
  return { galaxy: planet.galaxy, system: planet.system, slot: planet.slot };
}

function safeManifest(value: unknown, key: string): Record<string, number> | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value[key] !== 'number') return null;
  const count = value[key];
  return Number.isSafeInteger(count) && count >= 1 && count <= 100 ? { [key]: count } : null;
}

function safeCargo(value: unknown): { alloy: number; heliox: number; aether: number } | null {
  if (!isRecord(value) || Object.keys(value).length !== 3) return null;
  const { alloy, heliox, aether } = value;
  if (![alloy, heliox, aether].every((amount) => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0)) return null;
  return { alloy: alloy as number, heliox: heliox as number, aether: aether as number };
}

function activePhase(value: string | null): value is 'OUTBOUND' | 'RETURNING' {
  return value === 'OUTBOUND' || value === 'RETURNING';
}

function validDuration(value: number | null): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validFuel(value: number | null): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validTravel(departedAt: Date, arrivesAt: Date, durationSeconds: number, returnsAt?: Date | null, returnDurationSeconds?: number | null): boolean {
  const validReturn = returnsAt === undefined || (finiteTime(returnsAt) && validDuration(returnDurationSeconds ?? null)
    && returnsAt.getTime() - arrivesAt.getTime() === (returnDurationSeconds ?? 0) * 1_000);
  return finiteTime(departedAt)
    && finiteTime(arrivesAt)
    && arrivesAt.getTime() - departedAt.getTime() === durationSeconds * 1_000
    && validReturn;
}

function originPresentation(origin: { name: string; galaxy: number; system: number; slot: number }) {
  return { name: origin.name, coordinates: coordinate(origin) };
}

function presentDeploy(mission: OperationMission, userId: string): Operation | null {
  const origin = mission.deployOrigin;
  const destination = mission.deployDestination;
  if (mission.missionType !== MissionType.DEPLOY || mission.status !== MissionStatus.OUTBOUND || !origin || !destination
    || origin.ownerId !== userId || destination.ownerId !== userId || mission.originId !== origin.id
    || mission.deployOriginId !== origin.id || mission.deployDestinationId !== destination.id || mission.targetId !== destination.id
    || mission.targetGalaxy !== destination.galaxy || mission.targetSystem !== destination.system || mission.targetSlot !== destination.slot
    || !validFuel(mission.deployFuelHeliox) || !validDuration(mission.deployDurationSeconds)
    || !validTravel(mission.departedAt, mission.arrivesAt, mission.deployDurationSeconds)) return null;
  try {
    return { missionType: 'DEPLOY', phase: 'OUTBOUND', direction: 'OUTBOUND', origin: originPresentation(origin), destination: coordinate(destination), manifest: canonicalDeployShips(mission.deployShips), cargo: null, departedAt: mission.departedAt, nextEventAt: mission.arrivesAt };
  } catch { return null; }
}

function presentColonization(mission: OperationMission, userId: string): Operation | null {
  const origin = mission.origin;
  const target = { galaxy: mission.colonizationTargetGalaxy, system: mission.colonizationTargetSystem, slot: mission.colonizationTargetSlot };
  if (mission.missionType !== MissionType.COLONIZE || mission.status !== MissionStatus.OUTBOUND || !origin || origin.ownerId !== userId
    || mission.colonizationAccountId !== userId || mission.originId !== origin.id || mission.speedPercent !== 100
    || !validCoordinate(target as Coordinates) || target.galaxy !== origin.galaxy || target.system !== origin.system || target.slot === origin.slot
    || mission.targetGalaxy !== target.galaxy || mission.targetSystem !== target.system || mission.targetSlot !== target.slot
    || !safeManifest(mission.colonizationShips, 'colonyShip') || !validFuel(mission.colonizationFuelHeliox) || !validDuration(mission.colonizationDurationSeconds)
    || !isRecord(mission.colonizationCharacteristics) || !isRecord(mission.colonizationStarterState) || mission.createdPlanetId !== null
    || !validTravel(mission.departedAt, mission.arrivesAt, mission.colonizationDurationSeconds)) return null;
  return { missionType: 'COLONIZATION', phase: 'OUTBOUND', direction: 'OUTBOUND', origin: originPresentation(origin), destination: target as Coordinates, manifest: { colonyShip: 1 }, cargo: null, departedAt: mission.departedAt, nextEventAt: mission.arrivesAt };
}

function presentTransport(mission: OperationMission, userId: string): Operation | null {
  const origin = mission.transportOrigin;
  const destination = mission.transportDestination;
  const manifest = safeManifest(mission.transportShips, 'transporter');
  const cargo = safeCargo(mission.transportRemainingCargo);
  const phase = mission.transportPhase;
  const returning = phase === 'RETURNING';
  const waiting = phase === 'AWAITING_DESTINATION_CAPACITY';
  if (mission.missionType !== MissionType.TRANSPORT || !origin || !destination || origin.ownerId !== userId || destination.ownerId !== userId
    || origin.id === destination.id || mission.transportOriginId !== origin.id || mission.transportDestinationId !== destination.id
    || mission.originId !== origin.id || mission.targetId !== destination.id || mission.targetGalaxy !== destination.galaxy || mission.targetSystem !== destination.system || mission.targetSlot !== destination.slot
    || !manifest || !cargo || !safeCargo(mission.transportCargo) || !validFuel(mission.transportOutboundFuelHeliox) || !validFuel(mission.transportReturnFuelHeliox)
    || !validFuel(mission.transportTotalReservedFuelHeliox) || mission.transportTotalReservedFuelHeliox !== mission.transportOutboundFuelHeliox + mission.transportReturnFuelHeliox
    || !validDuration(mission.transportOutboundDurationSeconds) || !validDuration(mission.transportReturnDurationSeconds)
    || (phase !== 'OUTBOUND' && !waiting && !returning) || (returning ? mission.status !== MissionStatus.RETURNING : mission.status !== MissionStatus.OUTBOUND)
    || !validTravel(mission.departedAt, mission.arrivesAt, mission.transportOutboundDurationSeconds)
    || (returning && !finiteTime(mission.returnsAt))) return null;
  return { missionType: 'TRANSPORT', phase: phase as OperationPhase, direction: returning ? 'RETURNING' : 'OUTBOUND', origin: originPresentation(origin), destination: coordinate(destination), manifest, cargo, departedAt: mission.departedAt, nextEventAt: returning ? mission.returnsAt : waiting ? null : mission.arrivesAt };
}

function presentProbe(mission: OperationMission, userId: string): Operation | null {
  const origin = mission.espionageOriginPlanet;
  const target = mission.espionageTargetPlanet;
  const phase = mission.espionageProbePhase;
  if (mission.missionType !== MissionType.ESPIONAGE || !activePhase(phase) || mission.status !== phase || !origin || !target
    || origin.ownerId !== userId || target.ownerId === userId || mission.originId !== origin.id || mission.targetId !== target.id
    || mission.espionageOriginPlanetId !== origin.id || mission.espionageTargetPlanetId !== target.id || mission.espionageOriginAccountId !== userId || mission.espionageTargetAccountId !== target.ownerId
    || mission.targetGalaxy !== target.galaxy || mission.targetSystem !== target.system || mission.targetSlot !== target.slot || mission.speedPercent !== 100
    || !safeManifest(mission.espionageProbeShips, 'probe') || !validFuel(mission.espionageOutboundFuelHeliox) || !validFuel(mission.espionageReturnFuelHeliox)
    || !validDuration(mission.espionageOutboundDurationSeconds) || !validDuration(mission.espionageReturnDurationSeconds)
    || !validTravel(mission.departedAt, mission.arrivesAt, mission.espionageOutboundDurationSeconds, mission.returnsAt, mission.espionageReturnDurationSeconds)) return null;
  return { missionType: 'ESPIONAGE_PROBE', phase, direction: phase === 'RETURNING' ? 'RETURNING' : 'OUTBOUND', origin: originPresentation(origin), destination: coordinate(target), manifest: { probe: 1 }, cargo: null, departedAt: mission.departedAt, nextEventAt: phase === 'RETURNING' ? mission.returnsAt : mission.arrivesAt };
}

function presentStrike(mission: OperationMission, userId: string, kind: 'corvette' | 'frigate'): Operation | null {
  const prefix = kind === 'corvette' ? 'corvetteStrike' : 'frigateStrike';
  const origin = kind === 'corvette' ? mission.corvetteStrikeOriginPlanet : mission.frigateStrikeOriginPlanet;
  const target = kind === 'corvette' ? mission.corvetteStrikeTargetPlanet : mission.frigateStrikeTargetPlanet;
  const phase = kind === 'corvette' ? mission.corvetteStrikePhase : mission.frigateStrikePhase;
  const originId = kind === 'corvette' ? mission.corvetteStrikeOriginPlanetId : mission.frigateStrikeOriginPlanetId;
  const targetId = kind === 'corvette' ? mission.corvetteStrikeTargetPlanetId : mission.frigateStrikeTargetPlanetId;
  const attackerId = kind === 'corvette' ? mission.corvetteStrikeAttackerId : mission.frigateStrikeAttackerId;
  const defenderId = kind === 'corvette' ? mission.corvetteStrikeDefenderId : mission.frigateStrikeDefenderId;
  const ships = kind === 'corvette' ? mission.corvetteStrikeShips : mission.frigateStrikeShips;
  const outboundFuel = kind === 'corvette' ? mission.corvetteStrikeOutboundFuelHeliox : mission.frigateStrikeOutboundFuelHeliox;
  const returnFuel = kind === 'corvette' ? mission.corvetteStrikeReturnFuelHeliox : mission.frigateStrikeReturnFuelHeliox;
  const outboundDuration = kind === 'corvette' ? mission.corvetteStrikeOutboundDurationSeconds : mission.frigateStrikeOutboundDurationSeconds;
  const returnDuration = kind === 'corvette' ? mission.corvetteStrikeReturnDurationSeconds : mission.frigateStrikeReturnDurationSeconds;
  if (mission.missionType !== MissionType.ATTACK || !activePhase(phase) || mission.status !== phase || !origin || !target
    || origin.ownerId !== userId || target.ownerId === userId || mission.originId !== origin.id || mission.targetId !== target.id
    || originId !== origin.id || targetId !== target.id || attackerId !== userId || defenderId !== target.ownerId
    || mission.targetGalaxy !== target.galaxy || mission.targetSystem !== target.system || mission.targetSlot !== target.slot || mission.speedPercent !== 100
    || !safeManifest(ships, kind) || !validFuel(outboundFuel) || !validFuel(returnFuel) || !validDuration(outboundDuration) || !validDuration(returnDuration)
    || !validTravel(mission.departedAt, mission.arrivesAt, outboundDuration, mission.returnsAt, returnDuration)) return null;
  return { missionType: kind === 'corvette' ? 'CORVETTE_STRIKE' : 'FRIGATE_STRIKE', phase, direction: phase === 'RETURNING' ? 'RETURNING' : 'OUTBOUND', origin: originPresentation(origin), destination: coordinate(target), manifest: { [kind]: (safeManifest(ships, kind) as Record<string, number>)[kind] }, cargo: null, departedAt: mission.departedAt, nextEventAt: phase === 'RETURNING' ? mission.returnsAt : mission.arrivesAt };
}

function presentOperation(mission: OperationMission, userId: string): Operation | null {
  return presentDeploy(mission, userId)
    ?? presentColonization(mission, userId)
    ?? presentTransport(mission, userId)
    ?? presentProbe(mission, userId)
    ?? presentStrike(mission, userId, 'corvette')
    ?? presentStrike(mission, userId, 'frigate');
}

router.get('/', asyncHandler(async (req, res) => {
  const accountId = req.user!.id;
  const missions = await prisma.fleetMission.findMany({
    where: {
      OR: [
        { missionType: MissionType.DEPLOY, status: MissionStatus.OUTBOUND, deployOrigin: { is: { ownerId: accountId } } },
        { missionType: MissionType.COLONIZE, status: MissionStatus.OUTBOUND, colonizationAccountId: accountId },
        { missionType: MissionType.TRANSPORT, transportOrigin: { is: { ownerId: accountId } }, status: { in: [MissionStatus.OUTBOUND, MissionStatus.RETURNING] } },
        { missionType: MissionType.ESPIONAGE, espionageOriginAccountId: accountId, status: { in: [MissionStatus.OUTBOUND, MissionStatus.RETURNING] } },
        { missionType: MissionType.ATTACK, corvetteStrikeAttackerId: accountId, status: { in: [MissionStatus.OUTBOUND, MissionStatus.RETURNING] } },
        { missionType: MissionType.ATTACK, frigateStrikeAttackerId: accountId, status: { in: [MissionStatus.OUTBOUND, MissionStatus.RETURNING] } },
      ],
    },
    select: operationSelect,
    take: OPERATION_CANDIDATE_LIMIT,
  });
  const operations = missions.map((mission) => presentOperation(mission, accountId)).filter((operation): operation is Operation => operation !== null)
    .sort((left, right) => {
      const leftTime = left.nextEventAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightTime = right.nextEventAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.missionType.localeCompare(right.missionType) || left.origin.name.localeCompare(right.origin.name);
    })
    .slice(0, OPERATION_RESPONSE_LIMIT);
  res.json({ operations });
}));

export default router;
