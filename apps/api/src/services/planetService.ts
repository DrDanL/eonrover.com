import { Planet, Building, Ship, Defence, Prisma } from '@prisma/client';
import {
  BUILDINGS,
  BuildingKey,
  PLANET_TYPES,
  buildingEnergy,
  calculatePlanetProduction,
  storageCapacity,
  BASE_ENERGY_SUPPLY,
  ResourceAmounts,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { completeDueBuildingConstructionsForPlanet } from './buildingCompletionService';
import { getUniverseConfig } from './gameConfig';

export type PlanetTypeLower = 'temperate' | 'volcanic' | 'ice' | 'gasGiant' | 'barren' | 'oceanic';

export const PLANET_TYPE_DB_TO_SHARED: Record<string, PlanetTypeLower> = {
  TEMPERATE: 'temperate',
  VOLCANIC: 'volcanic',
  ICE: 'ice',
  GAS_GIANT: 'gasGiant',
  BARREN: 'barren',
  OCEANIC: 'oceanic',
};

export const PLANET_SYNC_TRANSACTION_ATTEMPTS = 3;

export interface PlanetEnergyInfo {
  supply: number;
  consumption: number;
  efficiency: number;
}

type PlanetTransaction = Prisma.TransactionClient;
type LockedPlanetOperation<T> = (tx: PlanetTransaction, planet: Planet) => Promise<T>;

export async function withLockedPlanet<T>(planetId: string, operation: LockedPlanetOperation<T>): Promise<T> {
  for (let attempt = 1; attempt <= PLANET_SYNC_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${planetId} FOR UPDATE`;
        const planet = await tx.planet.findUniqueOrThrow({ where: { id: planetId } });
        return operation(tx, planet);
      });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!retryable || attempt === PLANET_SYNC_TRANSACTION_ATTEMPTS) throw error;
    }
  }

  throw new Error('Planet transaction exhausted its retry limit');
}

export async function syncLockedPlanetResources(
  tx: PlanetTransaction,
  planet: Planet,
  currentTime: Date,
  economySpeed: number,
): Promise<{ planet: Planet; buildings: Building[]; energy: PlanetEnergyInfo; production: ResourceAmounts }> {
  const buildings = await tx.building.findMany({ where: { planetId: planet.id } });
  const byKey = new Map(buildings.map((building) => [building.key, building.level]));

  let energyConsumption = 0;
  let energyProduced = BASE_ENERGY_SUPPLY;
  for (const building of buildings) {
    const definition = BUILDINGS[building.key as BuildingKey];
    if (!definition) continue;
    const energy = buildingEnergy(definition.key, building.level, planet.solarIndex);
    if (energy >= 0) energyConsumption += energy;
    else energyProduced += -energy;
  }

  const production = calculatePlanetProduction({
    previousProductionAt: planet.lastProductionAt,
    currentTime,
    resources: { alloy: planet.alloy, heliox: planet.heliox, aether: planet.aether },
    buildingLevels: Object.fromEntries(byKey) as Partial<Record<BuildingKey, number>>,
    environment: {
      type: PLANET_TYPE_DB_TO_SHARED[planet.planetType] ?? 'temperate',
      temperature: planet.temperature,
      solarIndex: planet.solarIndex,
    },
    storage: {
      alloy: storageCapacity(byKey.get('alloyStorage') ?? 0),
      heliox: storageCapacity(byKey.get('helioxStorage') ?? 0),
      aether: storageCapacity(byKey.get('aetherStorage') ?? 0),
    },
    energySupply: energyProduced,
    energyDemand: energyConsumption,
    economySpeed,
    // Research production bonuses are advertised but not wired today;
    // Stage 3A deliberately preserves the existing modifier of 1.
    productionModifier: 1,
  });

  const changed =
    production.resources.alloy !== planet.alloy ||
    production.resources.heliox !== planet.heliox ||
    production.resources.aether !== planet.aether ||
    production.lastProductionAt.getTime() !== planet.lastProductionAt.getTime();
  const updated = changed
    ? await tx.planet.update({
        where: { id: planet.id },
        data: {
          ...production.resources,
          lastProductionAt: production.lastProductionAt,
        },
      })
    : planet;

  return {
    planet: updated,
    buildings,
    energy: {
      supply: energyProduced,
      consumption: energyConsumption,
      efficiency: production.energyEfficiency,
    },
    production: production.hourlyRates,
  };
}

/**
 * Recomputes accumulated resources for a planet based on elapsed time since
 * the last calculation, persists the new totals, and returns the refreshed
 * planet row plus its buildings. A PostgreSQL row lock serialises production
 * for this planet only; retryable transaction conflicts have a bounded retry.
 */
export async function syncPlanetResources(
  planetId: string,
  currentTime = new Date(),
): Promise<{ planet: Planet; buildings: Building[]; energy: PlanetEnergyInfo; production: ResourceAmounts }> {
  await completeDueBuildingConstructionsForPlanet(planetId, currentTime);
  const config = await getUniverseConfig();
  return withLockedPlanet(planetId, (tx, planet) =>
    syncLockedPlanetResources(tx, planet, currentTime, config.economySpeed),
  );
}

export async function getPlanetFullState(planetId: string, currentTime = new Date()) {
  const { planet, buildings, energy } = await syncPlanetResources(planetId, currentTime);
  const [ships, defences, buildQueue, researchQueue, shipyardQueue] = await Promise.all([
    prisma.ship.findMany({ where: { planetId } }),
    prisma.defence.findMany({ where: { planetId } }),
    prisma.buildQueueItem.findMany({ where: { planetId, status: 'PENDING' } }),
    prisma.researchQueueItem.findMany({ where: { planetId, status: 'PENDING' } }),
    prisma.shipyardQueueItem.findMany({ where: { planetId, status: 'PENDING' } }),
  ]);

  const storage = {
    alloy: storageCapacity(buildings.find((b: Building) => b.key === 'alloyStorage')?.level ?? 0),
    heliox: storageCapacity(buildings.find((b: Building) => b.key === 'helioxStorage')?.level ?? 0),
    aether: storageCapacity(buildings.find((b: Building) => b.key === 'aetherStorage')?.level ?? 0),
  };

  return { planet, buildings, ships, defences, buildQueue, researchQueue, shipyardQueue, energy, storage };
}

export function buildingLevelMap(buildings: Building[]): Record<string, number> {
  return Object.fromEntries(buildings.map((b) => [b.key, b.level]));
}

export function shipCountMap(ships: Ship[]): Record<string, number> {
  return Object.fromEntries(ships.map((s) => [s.key, s.count]));
}

export function defenceCountMap(defences: Defence[]): Record<string, number> {
  return Object.fromEntries(defences.map((d) => [d.key, d.count]));
}
