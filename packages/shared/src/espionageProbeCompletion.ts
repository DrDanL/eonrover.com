import { BUILDINGS, DEFENCES, PLANET_TYPES, SHIPS } from './constants';
import { discloseEspionageTarget } from './espionageDisclosure';
import { calculatePlanetEnergy, calculatePlanetProduction, storageCapacity } from './formulas';
import { BuildingKey, PlanetEnvironment, ResourceAmounts } from './types';

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

/** The minimal Prisma-like surface used by canonical Probe completion. */
export interface EspionageProbeCompletionDatabase {
  $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
}

export interface EspionageProbeCompletionOptions {
  scheduleReturnWakeup?: (missionId: string, currentTime: Date) => Promise<unknown>;
}

export type EspionageProbeCompletionOutcome = 'arrived' | 'returned' | 'early' | 'noop' | 'unavailable';

type CanonicalProbeMission = {
  ships: { probe: 1 };
  outboundFuelHeliox: number;
  returnFuelHeliox: number;
  outboundDurationSeconds: number;
  returnDurationSeconds: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function canonicalProbeManifest(value: unknown): { probe: 1 } | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || value.probe !== 1) return null;
  return { probe: 1 };
}

function canonicalProbeMission(mission: any): CanonicalProbeMission | null {
  const ships = canonicalProbeManifest(mission.espionageProbeShips);
  if (!ships
    || !nonNegativeSafeInteger(mission.espionageOutboundFuelHeliox)
    || !nonNegativeSafeInteger(mission.espionageReturnFuelHeliox)
    || !Number.isSafeInteger(mission.espionageOutboundDurationSeconds)
    || mission.espionageOutboundDurationSeconds <= 0
    || !Number.isSafeInteger(mission.espionageReturnDurationSeconds)
    || mission.espionageReturnDurationSeconds <= 0
    || !mission.arrivesAt || !mission.returnsAt
    || !Number.isFinite(mission.departedAt?.getTime())
    || !Number.isFinite(mission.arrivesAt.getTime())
    || !Number.isFinite(mission.returnsAt.getTime())
    || mission.arrivesAt.getTime() - mission.departedAt.getTime() !== mission.espionageOutboundDurationSeconds * 1_000
    || mission.returnsAt.getTime() - mission.arrivesAt.getTime() !== mission.espionageReturnDurationSeconds * 1_000
    || mission.speedPercent !== 100) return null;
  return {
    ships,
    outboundFuelHeliox: mission.espionageOutboundFuelHeliox,
    returnFuelHeliox: mission.espionageReturnFuelHeliox,
    outboundDurationSeconds: mission.espionageOutboundDurationSeconds,
    returnDurationSeconds: mission.espionageReturnDurationSeconds,
  };
}

function isRetryableTransactionError(error: any): boolean {
  return error?.code === 'P2034' || (error?.code === 'P2010' && error?.meta?.code === '40001');
}

function planetEnvironment(planet: any): PlanetEnvironment {
  const typeByDatabaseValue: Record<string, PlanetEnvironment['type']> = {
    TEMPERATE: 'temperate', VOLCANIC: 'volcanic', ICE: 'ice', GAS_GIANT: 'gasGiant', BARREN: 'barren', OCEANIC: 'oceanic',
  };
  return { type: typeByDatabaseValue[planet.planetType] ?? 'temperate', temperature: planet.temperature, solarIndex: planet.solarIndex };
}

function resourcesFromPlanet(planet: any): ResourceAmounts {
  return { alloy: planet.alloy, heliox: planet.heliox, aether: planet.aether };
}

async function economySpeed(tx: any): Promise<number> {
  const row = await tx.universeSetting.findUnique({ where: { key: 'economySpeed' }, select: { value: true } });
  return typeof row?.value === 'number' && Number.isFinite(row.value) && row.value > 0 ? row.value : 1;
}

/** Settles a planet under its existing row lock without reading any mission payload. */
async function syncLockedPlanetAt(
  tx: any,
  planet: any,
  currentTime: Date,
): Promise<{ planet: any; buildings: Array<{ key: string; level: number }> }> {
  const buildings = await tx.building.findMany({ where: { planetId: planet.id } });
  const levels = new Map<string, number>(buildings.map((building: { key: string; level: number }) => [building.key, building.level] as [string, number]));
  const buildingLevels = Object.fromEntries(levels) as Partial<Record<BuildingKey, number>>;
  const energy = calculatePlanetEnergy(buildingLevels, planet.solarIndex);
  const production = calculatePlanetProduction({
    previousProductionAt: planet.lastProductionAt,
    currentTime,
    resources: resourcesFromPlanet(planet),
    buildingLevels,
    environment: planetEnvironment(planet),
    storage: {
      alloy: storageCapacity(levels.get('alloyStorage') ?? 0),
      heliox: storageCapacity(levels.get('helioxStorage') ?? 0),
      aether: storageCapacity(levels.get('aetherStorage') ?? 0),
    },
    energySupply: energy.supply,
    energyDemand: energy.demand,
    economySpeed: await economySpeed(tx),
    productionModifier: 1,
  });
  const changed = production.resources.alloy !== planet.alloy
    || production.resources.heliox !== planet.heliox
    || production.resources.aether !== planet.aether
    || production.lastProductionAt.getTime() !== planet.lastProductionAt.getTime();
  return {
    planet: changed ? await tx.planet.update({
      where: { id: planet.id },
      data: { ...production.resources, lastProductionAt: production.lastProductionAt },
    }) : planet,
    buildings,
  };
}

function publicPlanetType(value: string): keyof typeof PLANET_TYPES | null {
  const map: Record<string, keyof typeof PLANET_TYPES> = {
    TEMPERATE: 'temperate', VOLCANIC: 'volcanic', ICE: 'ice', GAS_GIANT: 'gasGiant', BARREN: 'barren', OCEANIC: 'oceanic',
  };
  return map[value] ?? null;
}

function quantities(rows: Array<{ key: string; count: number }>, definitions: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.key in definitions && nonNegativeSafeInteger(row.count) && row.count > 0) result[row.key] = row.count;
  }
  return result;
}

function completedBuildingLevels(rows: Array<{ key: string; level: number }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.key in BUILDINGS && nonNegativeSafeInteger(row.level) && row.level > 0) result[row.key] = row.level;
  }
  return result;
}

/**
 * Settles only a persisted canonical Espionage Probe lifecycle. The caller
 * provides a mission id and authoritative time boundary; legacy JSON, queued
 * payload data, and client values are intentionally not game-state inputs.
 */
export async function settleCanonicalEspionageProbe(
  database: EspionageProbeCompletionDatabase,
  missionId: string,
  currentTime = new Date(),
  options: EspionageProbeCompletionOptions = {},
): Promise<EspionageProbeCompletionOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'noop';

  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      const outcome = await database.$transaction(async (tx) => {
        // sorted account ids → origin → target → Probe inventory → mission → report
        const accountLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT account."id" AS "id"
          FROM "User" AS account
          WHERE account."id" IN (
            SELECT mission."espionageOriginAccountId" FROM "FleetMission" AS mission WHERE mission."id" = ${missionId}
            UNION
            SELECT mission."espionageTargetAccountId" FROM "FleetMission" AS mission WHERE mission."id" = ${missionId}
          )
          ORDER BY account."id"
          FOR UPDATE
        `;
        if (accountLocks.length !== 2 || accountLocks[0].id === accountLocks[1].id) return 'noop';
        const accounts = await tx.user.findMany({
          where: { id: { in: accountLocks.map((account: { id: string }) => account.id) } },
          select: { id: true, username: true },
        });
        if (accounts.length !== 2) return 'noop';

        const originLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT origin."id" AS "id" FROM "Planet" AS origin
          JOIN "FleetMission" AS mission ON mission."espionageOriginPlanetId" = origin."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF origin
        `;
        if (originLocks.length !== 1) return 'noop';
        const origin = await tx.planet.findUnique({ where: { id: originLocks[0].id } });
        if (!origin) return 'noop';

        const targetLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT target."id" AS "id" FROM "Planet" AS target
          JOIN "FleetMission" AS mission ON mission."espionageTargetPlanetId" = target."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF target
        `;
        if (targetLocks.length !== 1) return 'noop';
        const target = await tx.planet.findUnique({ where: { id: targetLocks[0].id } });
        if (!target) return 'noop';

        await tx.$queryRaw`
          SELECT "id" FROM "Ship" WHERE "planetId" = ${origin.id} AND "key" = 'probe' FOR UPDATE
        `;
        await tx.$queryRaw`SELECT "id" FROM "FleetMission" WHERE "id" = ${missionId} FOR UPDATE`;
        const mission = await tx.fleetMission.findUnique({ where: { id: missionId } });
        if (!mission || mission.missionType !== 'ESPIONAGE'
          || !mission.espionageProbePhase
          || mission.espionageOriginPlanetId !== origin.id
          || mission.espionageTargetPlanetId !== target.id
          || mission.espionageOriginAccountId !== origin.ownerId
          || mission.espionageTargetAccountId !== target.ownerId
          || mission.originId !== origin.id
          || mission.targetId !== target.id
          || mission.targetGalaxy !== target.galaxy
          || mission.targetSystem !== target.system
          || mission.targetSlot !== target.slot
          || origin.ownerId === target.ownerId
          || !accountLocks.some((account: { id: string }) => account.id === origin.ownerId)
          || !accountLocks.some((account: { id: string }) => account.id === target.ownerId)) return 'noop';
        const canonical = canonicalProbeMission(mission);
        if (!canonical) return 'noop';
        // `espionageProbePhase` is the lifecycle authority. The legacy status
        // remains only a server-written compatibility mirror, so an
        // inconsistent or recalled row is malformed rather than a new outcome.
        if ((mission.espionageProbePhase === 'OUTBOUND' && mission.status !== 'OUTBOUND')
          || (mission.espionageProbePhase === 'RETURNING' && mission.status !== 'RETURNING')) return 'noop';

        await tx.$queryRaw`SELECT "id" FROM "EspionageProbeReport" WHERE "missionId" = ${missionId} FOR UPDATE`;
        const existingReport = await tx.espionageProbeReport.findUnique({ where: { missionId } });

        if (mission.espionageProbePhase === 'OUTBOUND') {
          if (mission.arrivesAt > currentTime) return 'early';
          if (existingReport) return 'noop';
          const targetType = publicPlanetType(target.planetType);
          if (!targetType) return 'noop';
          // The report records what was authoritative at the persisted arrival
          // boundary. A later read cannot roll production backwards.
          const settledTarget = await syncLockedPlanetAt(tx, target, mission.arrivesAt);
          const [attackerResearch, defenderResearch, targetShips, targetDefences] = await Promise.all([
            tx.research.findUnique({ where: { userId_key: { userId: origin.ownerId, key: 'espionageTech' } }, select: { level: true } }),
            tx.research.findUnique({ where: { userId_key: { userId: target.ownerId, key: 'espionageTech' } }, select: { level: true } }),
            tx.ship.findMany({ where: { planetId: target.id }, select: { key: true, count: true } }),
            tx.defence.findMany({ where: { planetId: target.id }, select: { key: true, count: true } }),
          ]);
          const targetOwner = accounts.find((account: { id: string; username: string }) => account.id === target.ownerId);
          if (!targetOwner) return 'noop';
          const report = discloseEspionageTarget({
            attackerEspionageTechnology: attackerResearch?.level ?? 0,
            defenderEspionageTechnology: defenderResearch?.level ?? 0,
            target: {
              publicIdentity: {
                coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot },
                planetName: target.name,
                planetType: targetType,
                ownerUsername: targetOwner.username,
              },
              resources: resourcesFromPlanet(settledTarget.planet),
              completedBuildings: completedBuildingLevels(settledTarget.buildings),
              ships: quantities(targetShips, SHIPS),
              defences: quantities(targetDefences, DEFENCES),
            },
          });
          const transition = await tx.fleetMission.updateMany({
            where: { id: mission.id, espionageProbePhase: 'OUTBOUND' },
            data: { espionageProbePhase: 'RETURNING', status: 'RETURNING' },
          });
          if (transition.count !== 1) return 'noop';
          await tx.espionageProbeReport.create({
            data: {
              missionId: mission.id,
              attackerId: origin.ownerId,
              targetPlanetId: target.id,
              createdAt: mission.arrivesAt,
              tier: report.tier,
              disclosureSnapshot: report,
            },
          });
          await tx.notification.create({
            data: { userId: origin.ownerId, type: 'ESPIONAGE_REPORT_READY', message: 'Your Espionage Probe report is ready.' },
          });
          await tx.notification.create({
            data: { userId: target.ownerId, type: 'ESPIONAGE_DETECTED', message: 'An Espionage Probe has scanned one of your planets.' },
          });
          if (mission.returnsAt > currentTime) return 'arrived';
        } else if (mission.espionageProbePhase !== 'RETURNING') {
          return 'noop';
        }

        if (!existingReport && mission.espionageProbePhase === 'RETURNING') return 'noop';

        // A late invocation may have just committed the arrival state above;
        // it may restore the reserved Probe in this same authoritative commit.
        if (mission.returnsAt > currentTime) return 'early';
        const completed = await tx.fleetMission.updateMany({
          where: { id: mission.id, espionageProbePhase: 'RETURNING' },
          data: { espionageProbePhase: 'COMPLETE', status: 'COMPLETE' },
        });
        if (completed.count !== 1) return 'noop';
        await tx.ship.upsert({
          where: { planetId_key: { planetId: origin.id, key: 'probe' } },
          update: { count: { increment: canonical.ships.probe } },
          create: { planetId: origin.id, key: 'probe', count: canonical.ships.probe },
        });
        return 'returned';
      }, { isolationLevel: 'Serializable' });
      // Arrival state commits before Redis is touched. A wake-up failure is
      // deliberately non-authoritative and cannot reverse report, mission, or
      // notification state.
      if (outcome === 'arrived') await options.scheduleReturnWakeup?.(missionId, currentTime);
      return outcome;
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS) continue;
      if (isRetryableTransactionError(error)) return 'unavailable';
      throw error;
    }
  }
  return 'unavailable';
}
