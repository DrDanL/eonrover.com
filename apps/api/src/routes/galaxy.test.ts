import { AccountStatus, PlanetType } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';

const app = createApp();
let sequence = 0;

async function createAccount(
  label: string,
  status: AccountStatus = 'ACTIVE',
  options: { verified?: boolean; protectedUntil?: Date | null; lastActiveAt?: Date | null } = {},
) {
  sequence += 1;
  const user = await prisma.user.create({
    data: {
      email: `${label}-${sequence}@example.com`,
      username: `${label}_${sequence}`,
      passwordHash: 'not-used',
      status,
      emailVerifiedAt: options.verified === false ? null : new Date('2026-01-01T00:00:00.000Z'),
      protectedUntil: options.protectedUntil,
      lastActiveAt: options.lastActiveAt,
    },
  });
  const token = `galaxy-${label}-${sequence}`;
  await prisma.session.create({
    data: {
      id: sessionTokenDigest(token),
      userId: user.id,
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function createPlanet(
  ownerId: string,
  slot: number,
  options: { name?: string; type?: PlanetType; alloy?: number; lastProductionAt?: Date } = {},
) {
  return prisma.planet.create({
    data: {
      ownerId,
      name: options.name ?? `World ${slot}`,
      galaxy: 1,
      system: 1,
      slot,
      planetType: options.type ?? 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: options.alloy ?? 0,
      heliox: 23,
      aether: 45,
      lastProductionAt: options.lastProductionAt,
    },
  });
}

describe('bounded privacy-safe Galaxy read model', () => {
  it('requires an active authenticated account without mutating an unavailable account session', async () => {
    await request(app).get('/api/galaxy/1/1').expect(401, { error: 'Not authenticated', code: 'UNAUTHENTICATED' });

    const suspended = await createAccount('suspended', 'SUSPENDED', {
      lastActiveAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await request(app).get('/api/galaxy/1/1').set('Cookie', suspended.cookie).expect(403, {
      error: 'This account is unavailable.', code: 'ACCOUNT_UNAVAILABLE',
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: suspended.user.id } })).toMatchObject({
      lastActiveAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(await prisma.session.count({ where: { userId: suspended.user.id } })).toBe(1);
  });

  it('enforces canonical lower and upper galaxy/system bounds without coercion', async () => {
    const viewer = await createAccount('viewer');
    await request(app).get('/api/galaxy/6/400').set('Cookie', viewer.cookie).expect(200);

    for (const path of [
      '/api/galaxy/0/1', '/api/galaxy/1/0', '/api/galaxy/7/1', '/api/galaxy/1/401',
      '/api/galaxy/-1/1', '/api/galaxy/1/-1', '/api/galaxy/1.5/1', '/api/galaxy/1/2.5',
      '/api/galaxy/1e1/1', '/api/galaxy/1/2x', '/api/galaxy/1%20/1', '/api/galaxy/Infinity/1',
    ]) {
      await request(app).get(path).set('Cookie', viewer.cookie).expect(400, {
        error: 'Invalid coordinates', code: 'BAD_REQUEST',
      });
    }
  });

  it('returns twelve stable slots with only safe public or unavailable occupancy projections', async () => {
    const viewer = await createAccount('viewer');
    const publicOwner = await createAccount('public', 'ACTIVE', {
      protectedUntil: new Date('2026-12-01T00:00:00.000Z'),
    });
    const suspendedOwner = await createAccount('suspended-owner', 'SUSPENDED');
    const pendingOwner = await createAccount('pending-owner', 'PENDING_VERIFICATION', { verified: false });
    await createPlanet(publicOwner.user.id, 2, { name: 'Public Horizon', type: 'OCEANIC' });
    await createPlanet(suspendedOwner.user.id, 5, { name: 'Suspended Secret' });
    await createPlanet(pendingOwner.user.id, 9, { name: 'Pending Secret' });

    const response = await request(app).get('/api/galaxy/1/1').set('Cookie', viewer.cookie).expect(200);
    expect(response.body).toEqual({
      galaxy: 1,
      system: 1,
      slots: expect.arrayContaining([
        { slot: 1, occupancy: 'empty' },
        {
          slot: 2,
          occupancy: 'public',
          planet: { name: 'Public Horizon', type: 'OCEANIC' },
          owner: { username: publicOwner.user.username },
        },
        { slot: 5, occupancy: 'unavailable' },
        { slot: 9, occupancy: 'unavailable' },
      ]),
    });
    expect(response.body.slots).toHaveLength(12);
    expect(response.body.slots.map((slot: { slot: number }) => slot.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('does not expose identifiers, resources, account state, or raw rows and does not mutate authoritative state', async () => {
    const viewerLastActiveAt = new Date('2026-03-01T00:00:00.000Z');
    const viewer = await createAccount('viewer', 'ACTIVE', { lastActiveAt: viewerLastActiveAt });
    const owner = await createAccount('visible-owner');
    const planetLastProductionAt = new Date('2026-03-02T00:00:00.000Z');
    const planet = await createPlanet(owner.user.id, 3, {
      name: 'Allowlisted World', alloy: 9876, lastProductionAt: planetLastProductionAt,
    });
    await prisma.ship.create({ data: { planetId: planet.id, key: 'probe', count: 9 } });
    await prisma.building.create({ data: { planetId: planet.id, key: 'researchLab', level: 7 } });
    await prisma.notification.create({ data: { userId: owner.user.id, type: 'PRIVATE', message: 'private' } });
    await prisma.fleetMission.create({
      data: {
        originId: planet.id,
        targetGalaxy: 1,
        targetSystem: 1,
        targetSlot: 4,
        missionType: 'ESPIONAGE',
        ships: { probe: 1 },
        cargo: { alloy: 0, heliox: 0, aether: 0 },
        arrivesAt: new Date('2026-12-01T00:00:00.000Z'),
      },
    });
    const before = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: planet.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: viewer.user.id } }),
      prisma.notification.count(),
      prisma.fleetMission.count(),
    ]);

    const response = await request(app).get('/api/galaxy/1/1').set('Cookie', viewer.cookie).expect(200);
    expect(response.body.slots[2]).toEqual({
      slot: 3,
      occupancy: 'public',
      planet: { name: 'Allowlisted World', type: 'TEMPERATE' },
      owner: { username: owner.user.username },
    });
    const serialized = JSON.stringify(response.body);
    for (const sensitiveValue of [planet.id, owner.user.id, viewer.user.id, owner.user.email, '9876', 'researchLab', 'probe', 'ESPIONAGE', 'PRIVATE', 'lastProductionAt', 'protectedUntil']) {
      expect(serialized).not.toContain(sensitiveValue);
    }

    const after = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: planet.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: viewer.user.id } }),
      prisma.notification.count(),
      prisma.fleetMission.count(),
    ]);
    expect(after[0].alloy).toBe(before[0].alloy);
    expect(after[0].lastProductionAt).toEqual(before[0].lastProductionAt);
    expect(after[1].lastActiveAt).toEqual(viewerLastActiveAt);
    expect(after.slice(2)).toEqual(before.slice(2));
  });
});
