import { storageCapacity } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { syncPlanetResources } from './planetService';

export const ADMIN_PLAYER_SEARCH_MAX_PAGE_SIZE = 50;

export interface AdminPlayerSearchInput {
  query: string;
  page: number;
  pageSize: number;
}

export async function searchAdminPlayers({ query, page, pageSize }: AdminPlayerSearchInput) {
  const where = {
    OR: [
      { id: query },
      { username: { contains: query, mode: 'insensitive' as const } },
      { email: { contains: query, mode: 'insensitive' as const } },
    ],
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: [{ username: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        _count: { select: { planets: true } },
      },
    }),
  ]);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    users: users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt,
      planetCount: user._count.planets,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  };
}

export async function getAdminPlayerState(playerId: string, currentTime = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: playerId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      createdAt: true,
      protectedUntil: true,
      planets: {
        orderBy: [{ galaxy: 'asc' }, { system: 'asc' }, { slot: 'asc' }, { id: 'asc' }],
        select: { id: true },
      },
    },
  });
  if (!user) return null;

  const planets = [];
  for (const planetReference of user.planets) {
    const { planet, buildings, energy, production } = await syncPlanetResources(planetReference.id, currentTime);
    const activeConstruction = await prisma.buildQueueItem.findFirst({
      where: { planetId: planet.id, status: 'PENDING' },
      orderBy: [{ completesAt: 'asc' }, { id: 'asc' }],
      select: {
        buildingKey: true,
        targetLevel: true,
        startedAt: true,
        completesAt: true,
      },
    });
    const buildingLevels = new Map(buildings.map((building) => [building.key, building.level]));

    planets.push({
      id: planet.id,
      name: planet.name,
      isHomeworld: planet.isHomeworld,
      galaxy: planet.galaxy,
      system: planet.system,
      position: planet.slot,
      planetType: planet.planetType,
      environment: {
        temperature: planet.temperature,
        solarIndex: planet.solarIndex,
      },
      resources: {
        alloy: planet.alloy,
        heliox: planet.heliox,
        aether: planet.aether,
      },
      lastProductionAt: planet.lastProductionAt,
      production,
      energy: {
        supply: energy.supply,
        demand: energy.consumption,
        efficiency: energy.efficiency,
      },
      storage: {
        alloy: storageCapacity(buildingLevels.get('alloyStorage') ?? 0),
        heliox: storageCapacity(buildingLevels.get('helioxStorage') ?? 0),
        aether: storageCapacity(buildingLevels.get('aetherStorage') ?? 0),
      },
      buildings: buildings
        .map((building) => ({ key: building.key, level: building.level }))
        .sort((left, right) => left.key.localeCompare(right.key)),
      activeConstruction: activeConstruction
        ? {
            buildingKey: activeConstruction.buildingKey,
            targetLevel: activeConstruction.targetLevel,
            status: 'PENDING' as const,
            startedAt: activeConstruction.startedAt,
            completesAt: activeConstruction.completesAt,
          }
        : null,
    });
  }

  const [activeSessionCount, unreadNotificationCount] = await Promise.all([
    prisma.session.count({ where: { userId: user.id, expiresAt: { gt: currentTime } } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return {
    player: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt,
      protectedUntil: user.protectedUntil,
      planetCount: planets.length,
      activeSessionCount,
      unreadNotificationCount,
    },
    planets,
  };
}
