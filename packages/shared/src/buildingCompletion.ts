import { BASE_ENERGY_SUPPLY, BUILDINGS } from './constants';
import { buildingEnergy, calculatePlanetProduction, storageCapacity } from './formulas';
import { BuildingKey, PlanetEnvironment, ResourceAmounts } from './types';

export const BUILD_COMPLETION_JOB_NAME = 'complete-building';
export const BUILD_COMPLETION_TRANSACTION_ATTEMPTS = 3;

export function buildCompletionJobId(constructionId: string): string {
  return `building-${constructionId}`;
}

export interface BuildingCompletionConstruction {
  id: string;
  planetId: string;
  buildingKey: string;
  targetLevel: number;
  completesAt: Date;
  status: 'PENDING' | 'COMPLETE' | 'CANCELLED';
}

export interface BuildingCompletionPlanet {
  id: string;
  ownerId: string;
  name: string;
  resources: ResourceAmounts;
  lastProductionAt: Date;
  environment: PlanetEnvironment;
}

export interface BuildingCompletionBuilding {
  key: string;
  level: number;
}

export interface BuildingCompletionTransaction {
  findConstruction(constructionId: string): Promise<BuildingCompletionConstruction | null>;
  lockPlanet(planetId: string): Promise<BuildingCompletionPlanet | null>;
  lockConstruction(
    constructionId: string,
    planetId: string,
  ): Promise<BuildingCompletionConstruction | null>;
  listBuildings(planetId: string): Promise<BuildingCompletionBuilding[]>;
  markConstructionComplete(constructionId: string): Promise<boolean>;
  updatePlanetResources(planetId: string, resources: ResourceAmounts, lastProductionAt: Date): Promise<void>;
  setBuildingLevel(planetId: string, buildingKey: string, level: number): Promise<void>;
  createCompletionNotification(userId: string, message: string): Promise<void>;
}

export interface BuildingCompletionStore {
  transaction<T>(operation: (tx: BuildingCompletionTransaction) => Promise<T>): Promise<T>;
  isRetryableTransactionError(error: unknown): boolean;
}

export type BuildingCompletionResult =
  | { outcome: 'missing' }
  | { outcome: 'already-complete' }
  | { outcome: 'cancelled' }
  | { outcome: 'too-early'; completesAt: Date }
  | { outcome: 'completed'; legacyPastFinish: boolean };

export class BuildingCompletionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildingCompletionInvariantError';
  }
}

interface ProductionState {
  resources: ResourceAmounts;
  lastProductionAt: Date;
}

function settleProduction(
  planet: BuildingCompletionPlanet,
  state: ProductionState,
  buildingLevels: Partial<Record<BuildingKey, number>>,
  currentTime: Date,
  economySpeed: number,
  preserveExistingMinimum = false,
): ProductionState {
  let energySupply = BASE_ENERGY_SUPPLY;
  let energyDemand = 0;
  for (const [key, level] of Object.entries(buildingLevels)) {
    const definition = BUILDINGS[key as BuildingKey];
    if (!definition) continue;
    const energy = buildingEnergy(definition.key, level, planet.environment.solarIndex);
    if (energy >= 0) energyDemand += energy;
    else energySupply += -energy;
  }

  const production = calculatePlanetProduction({
    previousProductionAt: state.lastProductionAt,
    currentTime,
    resources: state.resources,
    buildingLevels,
    environment: planet.environment,
    storage: {
      alloy: storageCapacity(buildingLevels.alloyStorage ?? 0),
      heliox: storageCapacity(buildingLevels.helioxStorage ?? 0),
      aether: storageCapacity(buildingLevels.aetherStorage ?? 0),
    },
    energySupply,
    energyDemand,
    economySpeed,
    // Research production bonuses remain deliberately deferred from Stage 3A.
    productionModifier: 1,
  });

  return {
    resources: preserveExistingMinimum
      ? {
          alloy: Math.max(state.resources.alloy, production.resources.alloy),
          heliox: Math.max(state.resources.heliox, production.resources.heliox),
          aether: Math.max(state.resources.aether, production.resources.aether),
        }
      : production.resources,
    lastProductionAt: production.lastProductionAt,
  };
}

function calculateCompletionTransition(
  planet: BuildingCompletionPlanet,
  buildings: BuildingCompletionBuilding[],
  construction: BuildingCompletionConstruction,
  processingTime: Date,
  economySpeed: number,
): ProductionState & { legacyPastFinish: boolean } {
  if (!(construction.buildingKey in BUILDINGS)) {
    throw new BuildingCompletionInvariantError(`Unknown building key on construction ${construction.id}`);
  }

  const key = construction.buildingKey as BuildingKey;
  const buildingLevels = Object.fromEntries(buildings.map((building) => [building.key, building.level])) as Partial<
    Record<BuildingKey, number>
  >;
  const currentLevel = buildingLevels[key] ?? 0;
  if (construction.targetLevel !== currentLevel + 1) {
    throw new BuildingCompletionInvariantError(`Invalid target level on construction ${construction.id}`);
  }

  const finishTime = construction.completesAt.getTime();
  const processingTimestamp = processingTime.getTime();
  if (!Number.isFinite(finishTime) || !Number.isFinite(processingTimestamp)) {
    throw new BuildingCompletionInvariantError(`Invalid completion timestamp on construction ${construction.id}`);
  }

  let state: ProductionState = {
    resources: planet.resources,
    lastProductionAt: planet.lastProductionAt,
  };
  const legacyPastFinish = planet.lastProductionAt.getTime() > finishTime;
  // Legacy rows may already have been settled beyond the finish time with the
  // old level. That interval cannot be reconstructed safely, so retain those
  // balances and apply the new level only from the stored timestamp onward.
  if (planet.lastProductionAt.getTime() < finishTime) {
    state = settleProduction(planet, state, buildingLevels, construction.completesAt, economySpeed);
  }

  const completedLevels = { ...buildingLevels, [key]: construction.targetLevel };
  state = settleProduction(
    planet,
    state,
    completedLevels,
    processingTime,
    economySpeed,
    legacyPastFinish,
  );
  return { ...state, legacyPastFinish };
}

/**
 * Completes one persisted building construction. PostgreSQL adapters provide
 * the transaction and row locks; this shared operation owns the transition,
 * idempotency checks, production split, and notification write order.
 */
export async function completeBuildingConstruction(
  store: BuildingCompletionStore,
  constructionId: string,
  processingTime: Date,
  economySpeed: number,
): Promise<BuildingCompletionResult> {
  for (let attempt = 1; attempt <= BUILD_COMPLETION_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await store.transaction(async (tx) => {
        const initial = await tx.findConstruction(constructionId);
        if (!initial) return { outcome: 'missing' };

        // Cancellation uses the same planet -> construction lock order.
        const planet = await tx.lockPlanet(initial.planetId);
        if (!planet) return { outcome: 'missing' };
        const construction = await tx.lockConstruction(constructionId, planet.id);
        if (!construction) return { outcome: 'missing' };
        if (construction.status === 'COMPLETE') return { outcome: 'already-complete' };
        if (construction.status === 'CANCELLED') return { outcome: 'cancelled' };
        if (processingTime.getTime() < construction.completesAt.getTime()) {
          return { outcome: 'too-early', completesAt: construction.completesAt };
        }

        const buildings = await tx.listBuildings(planet.id);
        const transition = calculateCompletionTransition(
          planet,
          buildings,
          construction,
          processingTime,
          economySpeed,
        );
        const claimed = await tx.markConstructionComplete(construction.id);
        if (!claimed) {
          throw new BuildingCompletionInvariantError(`Construction ${construction.id} lost its completion claim`);
        }

        await tx.updatePlanetResources(
          planet.id,
          transition.resources,
          transition.lastProductionAt,
        );
        await tx.setBuildingLevel(planet.id, construction.buildingKey, construction.targetLevel);
        await tx.createCompletionNotification(
          planet.ownerId,
          `${construction.buildingKey} reached level ${construction.targetLevel} on ${planet.name}.`,
        );

        return { outcome: 'completed', legacyPastFinish: transition.legacyPastFinish };
      });
    } catch (error) {
      if (!store.isRetryableTransactionError(error) || attempt === BUILD_COMPLETION_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new Error('Building completion exhausted its retry limit');
}
