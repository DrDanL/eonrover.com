import { Prisma } from '@prisma/client';
import {
  BuildingCompletionConstruction,
  BuildingCompletionPlanet,
  BuildingCompletionStore,
  BuildingCompletionTransaction,
  completeBuildingConstruction as completeBuildingConstructionDomain,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { getUniverseConfig } from './gameConfig';

const API_COMPLETION_BATCH_SIZE = 10;

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

export async function completeBuildingConstruction(constructionId: string, processingTime: Date) {
  const config = await getUniverseConfig();
  return completeBuildingConstructionDomain(
    completionStore,
    constructionId,
    processingTime,
    config.economySpeed,
  );
}

export async function completeDueBuildingConstructionsForPlanet(
  planetId: string,
  processingTime: Date,
): Promise<void> {
  const due = await prisma.buildQueueItem.findMany({
    where: {
      planetId,
      status: 'PENDING',
      completesAt: { lte: processingTime },
    },
    orderBy: [{ completesAt: 'asc' }, { id: 'asc' }],
    take: API_COMPLETION_BATCH_SIZE,
    select: { id: true },
  });
  for (const construction of due) {
    await completeBuildingConstruction(construction.id, processingTime);
  }
}
