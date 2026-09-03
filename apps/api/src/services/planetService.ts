import { Planet, Building, Ship, Defence } from '@prisma/client';
import {
  BuildingKey,
  PLANET_TYPES,
  accumulateProduction,
  buildingEnergy,
  energyEfficiency,
  hourlyProduction,
  planetProductionMultiplier,
  storageCapacity,
  BASE_ENERGY_SUPPLY,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
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

const PRODUCTION_BUILDINGS: Array<'alloyMine' | 'helioxExtractor' | 'aetherSynthesizer'> = [
  'alloyMine',
  'helioxExtractor',
  'aetherSynthesizer',
];

export interface PlanetEnergyInfo {
  supply: number;
  consumption: number;
  efficiency: number;
}

/**
 * Recomputes accumulated resources for a planet based on elapsed time since
 * the last calculation, persists the new totals, and returns the refreshed
 * planet row plus its buildings. This is the single place resource totals
 * are advanced — the client never supplies resource amounts.
 */
export async function syncPlanetResources(
  planetId: string,
): Promise<{ planet: Planet; buildings: Building[]; energy: PlanetEnergyInfo }> {
  const config = await getUniverseConfig();

  return prisma.$transaction(async (tx) => {
    const planet = await tx.planet.findUniqueOrThrow({ where: { id: planetId } });
    const buildings = await tx.building.findMany({ where: { planetId } });
    const byKey = new Map(buildings.map((b) => [b.key, b.level]));

    const sharedType = PLANET_TYPE_DB_TO_SHARED[planet.planetType] ?? 'temperate';
    const solarIndex = planet.solarIndex;

    let energyConsumption = 0;
    let energyProduced = BASE_ENERGY_SUPPLY;
    for (const key of Object.keys(byKey) as BuildingKey[]) {
      const level = byKey.get(key) ?? 0;
      const e = buildingEnergy(key, level, solarIndex);
      if (e >= 0) energyConsumption += e;
      else energyProduced += -e;
    }
    const efficiency = energyEfficiency(energyProduced, energyConsumption);

    const now = new Date();
    const elapsedSeconds = Math.max(0, (now.getTime() - planet.lastProductionAt.getTime()) / 1000);

    const updates: Record<string, number> = {};
    for (const key of PRODUCTION_BUILDINGS) {
      const level = byKey.get(key) ?? 0;
      if (level <= 0) continue;
      const resource = key === 'alloyMine' ? 'alloy' : key === 'helioxExtractor' ? 'heliox' : 'aether';
      const multiplier = planetProductionMultiplier(
        { type: sharedType, temperature: planet.temperature, solarIndex },
        resource,
      );
      const hourly = hourlyProduction(key, level, multiplier, config.economySpeed) * efficiency;
      const storageKey = `${resource}Storage` as BuildingKey;
      const capacity = storageCapacity(byKey.get(storageKey) ?? 0);
      const current = (planet as unknown as Record<string, number>)[resource];
      updates[resource] = accumulateProduction(current, hourly, elapsedSeconds, capacity);
    }

    const updated = await tx.planet.update({
      where: { id: planetId },
      data: { ...updates, lastProductionAt: now },
    });

    return {
      planet: updated,
      buildings,
      energy: { supply: energyProduced, consumption: energyConsumption, efficiency },
    };
  });
}

export async function getPlanetFullState(planetId: string) {
  const { planet, buildings, energy } = await syncPlanetResources(planetId);
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
