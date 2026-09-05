import { Prisma } from '@prisma/client';
import {
  BuildingCompletionConstruction,
  BuildingCompletionPlanet,
  BuildingCompletionStore,
  BuildingCompletionTransaction,
  DEFAULT_UNIVERSE_CONFIG,
  completeBuildingConstruction as completeBuildingConstructionDomain,
} from '@eonrover/shared';
import { prisma } from './prisma';

const PLANET_TYPE = {
  TEMPERATE: 'temperate',
  VOLCANIC: 'volcanic',
  ICE: 'ice',
  GAS_GIANT: 'gasGiant',
  BARREN: 'barren',
  OCEANIC: 'oceanic',
} as const;

function constructionRow(row: {
  id: string;
  planetId: string;
  buildingKey: string;
  targetLevel: number;
  completesAt: Date;
  status: 'PENDING' | 'COMPLETE' | 'CANCELLED';
}): BuildingCompletionConstruction {
  return row;
}

function transactionAdapter(tx: Prisma.TransactionClient): BuildingCompletionTransaction {
  return {
    async findConstruction(constructionId) {
      const row = await tx.buildQueueItem.findUnique({ where: { id: constructionId } });
      return row ? constructionRow(row) : null;
    },
    async lockPlanet(planetId) {
      await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${planetId} FOR UPDATE`;
      const planet = await tx.planet.findUnique({ where: { id: planetId } });
      if (!planet) return null;
      return {
        id: planet.id,
        ownerId: planet.ownerId,
        name: planet.name,
        resources: { alloy: planet.alloy, heliox: planet.heliox, aether: planet.aether },
        lastProductionAt: planet.lastProductionAt,
        environment: {
          type: PLANET_TYPE[planet.planetType],
          temperature: planet.temperature,
          solarIndex: planet.solarIndex,
        },
      } satisfies BuildingCompletionPlanet;
    },
    async lockConstruction(constructionId, planetId) {
      await tx.$queryRaw`
        SELECT "id"
        FROM "BuildQueueItem"
        WHERE "id" = ${constructionId} AND "planetId" = ${planetId}
        FOR UPDATE
      `;
      const row = await tx.buildQueueItem.findFirst({ where: { id: constructionId, planetId } });
      return row ? constructionRow(row) : null;
    },
    async listBuildings(planetId) {
      return tx.building.findMany({ where: { planetId }, select: { key: true, level: true } });
    },
    async markConstructionComplete(constructionId) {
      const result = await tx.buildQueueItem.updateMany({
        where: { id: constructionId, status: 'PENDING' },
        data: { status: 'COMPLETE' },
      });
      return result.count === 1;
    },
    async updatePlanetResources(planetId, resources, lastProductionAt) {
      await tx.planet.update({ where: { id: planetId }, data: { ...resources, lastProductionAt } });
    },
    async setBuildingLevel(planetId, buildingKey, level) {
      await tx.building.upsert({
        where: { planetId_key: { planetId, key: buildingKey } },
        update: { level },
        create: { planetId, key: buildingKey, level },
      });
    },
    async createCompletionNotification(userId, message) {
      await tx.notification.create({ data: { userId, type: 'BUILDING_COMPLETE', message } });
    },
  };
}

const completionStore: BuildingCompletionStore = {
  transaction: (operation) => prisma.$transaction((tx) => operation(transactionAdapter(tx))),
  isRetryableTransactionError: (error) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034',
};

async function economySpeed(): Promise<number> {
  const setting = await prisma.universeSetting.findUnique({ where: { key: 'economySpeed' } });
  return typeof setting?.value === 'number' && Number.isFinite(setting.value)
    ? setting.value
    : DEFAULT_UNIVERSE_CONFIG.economySpeed;
}

export async function completeBuildingConstruction(constructionId: string, processingTime: Date) {
  return completeBuildingConstructionDomain(
    completionStore,
    constructionId,
    processingTime,
    await economySpeed(),
  );
}
