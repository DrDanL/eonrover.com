import { calculatePlanetEnergy, calculatePlanetProduction, storageCapacity } from './formulas';
import { BuildingKey, PlanetEnvironment, ResourceAmounts } from './types';

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

export type TransportCompletionOutcome =
  | 'delivered'
  | 'awaiting-capacity'
  | 'returned'
  | 'early'
  | 'noop'
  | 'unavailable';

export interface TransportCompletionDatabase {
  $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
}

export interface TransportCompletionOptions {
  scheduleReturnWakeup?: (missionId: string, currentTime: Date) => Promise<unknown>;
}

type CanonicalTransport = {
  ships: { transporter: number };
  originalCargo: ResourceAmounts;
  remainingCargo: ResourceAmounts;
  returnDurationSeconds: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function resourceSnapshot(value: unknown): ResourceAmounts | null {
  if (!isRecord(value) || Object.keys(value).length !== 3) return null;
  const { alloy, heliox, aether } = value;
  if (!nonNegativeSafeInteger(alloy) || !nonNegativeSafeInteger(heliox) || !nonNegativeSafeInteger(aether)) return null;
  return { alloy, heliox, aether };
}

function transporterSnapshot(value: unknown): { transporter: number } | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.transporter !== 'number') return null;
  if (!Number.isSafeInteger(value.transporter) || value.transporter < 1 || value.transporter > 100) return null;
  return { transporter: value.transporter };
}

function canonicalTransport(mission: any): CanonicalTransport | null {
  const ships = transporterSnapshot(mission.transportShips);
  const originalCargo = resourceSnapshot(mission.transportCargo);
  const remainingCargo = resourceSnapshot(mission.transportRemainingCargo);
  if (!ships || !originalCargo || !remainingCargo
    || !nonNegativeSafeInteger(mission.transportCapacity)
    || !nonNegativeSafeInteger(mission.transportOutboundFuelHeliox)
    || !nonNegativeSafeInteger(mission.transportReturnFuelHeliox)
    || !nonNegativeSafeInteger(mission.transportTotalReservedFuelHeliox)
    || !nonNegativeSafeInteger(mission.transportOutboundDurationSeconds)
    || !nonNegativeSafeInteger(mission.transportReturnDurationSeconds)
    || mission.transportOutboundDurationSeconds === 0 || mission.transportReturnDurationSeconds === 0
    || mission.transportTotalReservedFuelHeliox !== mission.transportOutboundFuelHeliox + mission.transportReturnFuelHeliox
    || mission.transportCapacity < originalCargo.alloy + originalCargo.heliox + originalCargo.aether) return null;
  return { ships, originalCargo, remainingCargo, returnDurationSeconds: mission.transportReturnDurationSeconds };
}

function sameResources(left: ResourceAmounts, right: ResourceAmounts): boolean {
  return left.alloy === right.alloy && left.heliox === right.heliox && left.aether === right.aether;
}

function zeroResources(value: ResourceAmounts): boolean {
  return value.alloy === 0 && value.heliox === 0 && value.aether === 0;
}

function capacitiesFor(buildings: Array<{ key: string; level: number }>): ResourceAmounts {
  const levels = new Map(buildings.map((building) => [building.key, building.level]));
  return {
    alloy: storageCapacity(levels.get('alloyStorage') ?? 0),
    heliox: storageCapacity(levels.get('helioxStorage') ?? 0),
    aether: storageCapacity(levels.get('aetherStorage') ?? 0),
  };
}

function fits(resources: ResourceAmounts, capacity: ResourceAmounts, cargo: ResourceAmounts): boolean {
  return resources.alloy + cargo.alloy <= capacity.alloy
    && resources.heliox + cargo.heliox <= capacity.heliox
    && resources.aether + cargo.aether <= capacity.aether;
}

function isRetryableTransactionError(error: any): boolean {
  return error?.code === 'P2034' || (error?.code === 'P2010' && error?.meta?.code === '40001');
}

function environment(planet: any): PlanetEnvironment {
  const typeByDatabaseValue: Record<string, PlanetEnvironment['type']> = {
    TEMPERATE: 'temperate', VOLCANIC: 'volcanic', ICE: 'ice', GAS_GIANT: 'gasGiant', BARREN: 'barren', OCEANIC: 'oceanic',
  };
  return { type: typeByDatabaseValue[planet.planetType] ?? 'temperate', temperature: planet.temperature, solarIndex: planet.solarIndex };
}

async function economySpeed(tx: any): Promise<number> {
  const row = await tx.universeSetting.findUnique({ where: { key: 'economySpeed' }, select: { value: true } });
  return typeof row?.value === 'number' && Number.isFinite(row.value) && row.value > 0 ? row.value : 1;
}

async function syncLockedPlanetResources(tx: any, planet: any, currentTime: Date, speed: number): Promise<{ planet: any; buildings: Array<{ key: string; level: number }> }> {
  const buildings = await tx.building.findMany({ where: { planetId: planet.id } });
  const levels = new Map(buildings.map((building: { key: string; level: number }) => [building.key, building.level]));
  const buildingLevels = Object.fromEntries(levels) as Partial<Record<BuildingKey, number>>;
  const energy = calculatePlanetEnergy(buildingLevels, planet.solarIndex);
  const production = calculatePlanetProduction({
    previousProductionAt: planet.lastProductionAt,
    currentTime,
    resources: { alloy: planet.alloy, heliox: planet.heliox, aether: planet.aether },
    buildingLevels,
    environment: environment(planet),
    storage: capacitiesFor(buildings),
    energySupply: energy.supply,
    energyDemand: energy.demand,
    economySpeed: speed,
    productionModifier: 1,
  });
  const changed = production.resources.alloy !== planet.alloy
    || production.resources.heliox !== planet.heliox
    || production.resources.aether !== planet.aether
    || production.lastProductionAt.getTime() !== planet.lastProductionAt.getTime();
  const updated = changed ? await tx.planet.update({
    where: { id: planet.id },
    data: { ...production.resources, lastProductionAt: production.lastProductionAt },
  }) : planet;
  return { planet: updated, buildings };
}

/**
 * The single PostgreSQL-authoritative transport state transition. Redis is
 * deliberately absent from this transaction; callers may attach a best-effort
 * post-commit return wake-up after a delivery has committed.
 */
export async function settleCanonicalTransport(
  database: TransportCompletionDatabase,
  missionId: string,
  currentTime = new Date(),
  options: TransportCompletionOptions = {},
): Promise<TransportCompletionOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'noop';
  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      const outcome = await database.$transaction(async (tx) => {
        // account → origin → destination → mission → destination resources / origin inventory
        const accountLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT account."id" AS "id" FROM "User" AS account
          JOIN "Planet" AS origin ON origin."ownerId" = account."id"
          JOIN "FleetMission" AS mission ON mission."transportOriginId" = origin."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF account
        `;
        if (accountLocks.length !== 1) return 'noop';
        const account = await tx.user.findUnique({ where: { id: accountLocks[0].id }, select: { id: true } });
        if (!account) return 'noop';
        const originLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT origin."id" AS "id" FROM "Planet" AS origin
          JOIN "FleetMission" AS mission ON mission."transportOriginId" = origin."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF origin
        `;
        if (originLocks.length !== 1) return 'noop';
        const origin = await tx.planet.findUnique({ where: { id: originLocks[0].id } });
        if (!origin) return 'noop';
        const destinationLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT destination."id" AS "id" FROM "Planet" AS destination
          JOIN "FleetMission" AS mission ON mission."transportDestinationId" = destination."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF destination
        `;
        if (destinationLocks.length !== 1) return 'noop';
        const destination = await tx.planet.findUnique({ where: { id: destinationLocks[0].id } });
        if (!destination) return 'noop';
        await tx.$queryRaw`SELECT "id" FROM "FleetMission" WHERE "id" = ${missionId} FOR UPDATE`;
        const mission = await tx.fleetMission.findUnique({ where: { id: missionId } });
        if (!mission || mission.missionType !== 'TRANSPORT' || !mission.transportPhase
          || mission.transportOriginId !== origin.id || mission.transportDestinationId !== destination.id
          || origin.ownerId !== account.id || destination.ownerId !== account.id || mission.speedPercent !== 100
          || !Number.isFinite(mission.arrivesAt.getTime())) return 'noop';
        const canonical = canonicalTransport(mission);
        if (!canonical) return 'noop';

        if (mission.transportPhase === 'OUTBOUND' || mission.transportPhase === 'AWAITING_DESTINATION_CAPACITY') {
          if (mission.status !== 'OUTBOUND' || !sameResources(canonical.originalCargo, canonical.remainingCargo)) return 'noop';
          if (mission.transportPhase === 'OUTBOUND' && mission.arrivesAt > currentTime) return 'early';
          const synced = await syncLockedPlanetResources(tx, destination, currentTime, await economySpeed(tx));
          if (!fits(synced.planet, capacitiesFor(synced.buildings), canonical.remainingCargo)) {
            if (mission.transportPhase === 'AWAITING_DESTINATION_CAPACITY') return 'awaiting-capacity';
            const wait = await tx.fleetMission.updateMany({
              where: { id: mission.id, transportPhase: 'OUTBOUND', status: 'OUTBOUND' },
              data: { transportPhase: 'AWAITING_DESTINATION_CAPACITY' },
            });
            if (wait.count === 1) await tx.notification.create({ data: { userId: account.id, type: 'TRANSPORT_AWAITING_CAPACITY', message: 'A transport mission is waiting for destination storage capacity.' } });
            return wait.count === 1 ? 'awaiting-capacity' : 'noop';
          }
          const returnsAt = new Date(currentTime.getTime() + canonical.returnDurationSeconds * 1_000);
          const delivered = await tx.fleetMission.updateMany({
            where: { id: mission.id, status: 'OUTBOUND', transportPhase: { in: ['OUTBOUND', 'AWAITING_DESTINATION_CAPACITY'] } },
            data: { status: 'RETURNING', transportPhase: 'RETURNING', transportRemainingCargo: { alloy: 0, heliox: 0, aether: 0 }, returnsAt },
          });
          if (delivered.count !== 1) return 'noop';
          await tx.planet.update({ where: { id: synced.planet.id }, data: {
            alloy: synced.planet.alloy + canonical.remainingCargo.alloy,
            heliox: synced.planet.heliox + canonical.remainingCargo.heliox,
            aether: synced.planet.aether + canonical.remainingCargo.aether,
          } });
          await tx.notification.create({ data: { userId: account.id, type: 'TRANSPORT_DELIVERED', message: 'A transport mission has delivered its cargo and is returning.' } });
          return 'delivered';
        }

        if (mission.transportPhase !== 'RETURNING' || mission.status !== 'RETURNING' || !mission.returnsAt
          || !Number.isFinite(mission.returnsAt.getTime()) || !zeroResources(canonical.remainingCargo)) return 'noop';
        if (mission.returnsAt > currentTime) return 'early';
        await tx.$queryRaw`SELECT "id" FROM "Ship" WHERE "planetId" = ${origin.id} AND "key" = 'transporter' FOR UPDATE`;
        const completed = await tx.fleetMission.updateMany({
          where: { id: mission.id, transportPhase: 'RETURNING', status: 'RETURNING' },
          data: { transportPhase: 'COMPLETE', status: 'COMPLETE' },
        });
        if (completed.count !== 1) return 'noop';
        await tx.ship.upsert({
          where: { planetId_key: { planetId: origin.id, key: 'transporter' } },
          update: { count: { increment: canonical.ships.transporter } },
          create: { planetId: origin.id, key: 'transporter', count: canonical.ships.transporter },
        });
        await tx.notification.create({ data: { userId: account.id, type: 'TRANSPORT_RETURNED', message: 'Transporters have returned to their origin planet.' } });
        return 'returned';
      }, { isolationLevel: 'Serializable' });
      if (outcome === 'delivered') await options.scheduleReturnWakeup?.(missionId, currentTime);
      return outcome;
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS) continue;
      if (isRetryableTransactionError(error)) return 'unavailable';
      throw error;
    }
  }
  return 'unavailable';
}
