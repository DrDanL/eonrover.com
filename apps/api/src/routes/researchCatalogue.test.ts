import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';

const app = createApp();
const NOW = new Date('2026-09-06T12:00:00.000Z');
let slot = 1;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  jest.setSystemTime(NOW);
  slot = 1;
});
afterEach(() => jest.useRealTimers());

async function player(name: string, options: { alloy?: number; researchLab?: number } = {}) {
  const user = await prisma.user.create({ data: { email: `${name}@example.com`, username: name, passwordHash: 'unused', status: 'ACTIVE', emailVerifiedAt: NOW } });
  const createPlanet = (suffix: string) => prisma.planet.create({
    data: {
      ownerId: user.id, name: `${name} ${suffix}`, galaxy: 1, system: 1, slot: slot++, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
      alloy: options.alloy ?? 500, heliox: 300, aether: 20, lastProductionAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      buildings: { create: [{ key: 'alloyMine', level: 1 }, { key: 'helioxExtractor', level: 1 }, { key: 'solarArray', level: 1 }, { key: 'researchLab', level: options.researchLab ?? 0 }] },
    },
  });
  const first = await createPlanet('One');
  const second = await createPlanet('Two');
  const rawToken = `research-catalogue-${user.id}`;
  await prisma.session.create({ data: { id: sessionTokenDigest(rawToken), userId: user.id, expiresAt: new Date(NOW.getTime() + 86400000) } });
  return { user, first, second, cookie: `${SESSION_COOKIE}=${rawToken}` };
}

describe('read-only research catalogue', () => {
  it('starts an ACTIVE technology atomically with authoritative snapshots and one account-wide queue', async () => {
    const owner = await player('research-start', { researchLab: 3 });
    await prisma.planet.updateMany({ where: { ownerId: owner.user.id }, data: { alloy: 2000, heliox: 2000, aether: 2000, lastProductionAt: NOW } });
    const body = { key: 'espionageTech', planetId: owner.first.id, targetLevel: 99, cost: { alloy: 0 }, durationSeconds: 1 };
    const response = await request(app).post('/api/research').set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send(body).expect(201);
    expect(response.body.queueItem).toMatchObject({ technologyId: 'espionageTech', targetLevel: 1, cost: { alloy: 200, heliox: 400, aether: 20 }, status: 'PENDING' });
    expect(response.body.queueItem).not.toHaveProperty('jobId');
    const [first, second] = await Promise.all([
      request(app).post('/api/research').set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'espionageTech', planetId: owner.first.id }),
      request(app).post('/api/research').set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'espionageTech', planetId: owner.second.id }),
    ]);
    expect([first.status, second.status]).toEqual([409, 409]);
    expect(await prisma.researchQueueItem.count({ where: { userId: owner.user.id, status: 'PENDING' } })).toBe(1);
  });

  it('blocks planned effects without a deduction and cancels an active item with one refund to its origin planet', async () => {
    const owner = await player('research-cancel', { researchLab: 4, alloy: 2000 });
    await prisma.planet.update({ where: { id: owner.first.id }, data: { aether: 100, lastProductionAt: NOW } });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: owner.first.id } });
    const planned = await request(app).post('/api/research').set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'propulsionTheory', planetId: owner.first.id }).expect(409);
    expect(planned.body.code).toBe('RESEARCH_EFFECT_UNAVAILABLE');
    const started = await request(app).post('/api/research').set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'weaponTech', planetId: owner.first.id }).expect(201);
    const cancelled = await request(app).delete(`/api/research/${started.body.queueItem.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(200);
    expect(cancelled.body.refund).toEqual({ alloy: 150, heliox: 150, aether: 20 });
    await request(app).delete(`/api/research/${started.body.queueItem.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(409);
    const after = await prisma.planet.findUniqueOrThrow({ where: { id: owner.first.id } });
    expect(after.alloy).toBeCloseTo(before.alloy - 150);
  });
  it('requires authentication and ownership for the selected planet', async () => {
    const owner = await player('research-owner');
    const other = await player('research-other');
    await request(app).get(`/api/research?planetId=${owner.first.id}`).expect(401);
    await request(app).get(`/api/research?planetId=${other.first.id}`).set('Cookie', owner.cookie).expect(404);
  });

  it('returns all persisted technologies, account-wide levels, selected-lab data and only allowlisted fields', async () => {
    const owner = await player('research-reader', { researchLab: 3 });
    await prisma.research.create({ data: { userId: owner.user.id, key: 'espionageTech', level: 2 } });
    const response = await request(app).get(`/api/research?planetId=${owner.first.id}`).set('Cookie', owner.cookie).expect(200);
    expect(response.body.catalog.map((entry: { id: string }) => entry.id)).toEqual(['alloyProcessing', 'helioxCombustion', 'aetherPhysics', 'propulsionTheory', 'espionageTech', 'shieldTech', 'weaponTech', 'armourTech', 'gateTheory']);
    expect(response.body.selectedPlanet).toMatchObject({ id: owner.first.id, researchLabLevel: 3 });
    expect(response.body.accountResearchLevels).toEqual({ espionageTech: 2 });
    expect(response.body.catalog.find((entry: { id: string }) => entry.id === 'espionageTech')).toMatchObject({ currentLevel: 2, nextLevel: 3, effect: { status: 'ACTIVE' }, scheduling: { available: false } });
    expect(response.body.catalog[0]).not.toHaveProperty('baseCost');
    expect(JSON.stringify(response.body)).not.toContain('jobId');
  });

  it('keeps completed levels account-wide while using each owned planet laboratory and resources', async () => {
    const owner = await player('research-account', { researchLab: 1 });
    await prisma.building.update({ where: { planetId_key: { planetId: owner.second.id, key: 'researchLab' } }, data: { level: 4 } });
    await prisma.research.create({ data: { userId: owner.user.id, key: 'aetherPhysics', level: 3 } });
    const [first, second] = await Promise.all([
      request(app).get(`/api/research?planetId=${owner.first.id}`).set('Cookie', owner.cookie),
      request(app).get(`/api/research?planetId=${owner.second.id}`).set('Cookie', owner.cookie),
    ]);
    expect(first.body.accountResearchLevels).toEqual(second.body.accountResearchLevels);
    expect(first.body.selectedPlanet.researchLabLevel).toBe(1);
    expect(second.body.selectedPlanet.researchLabLevel).toBe(4);
    expect(first.body.catalog.find((entry: { id: string }) => entry.id === 'gateTheory').requirements[0]).toMatchObject({ met: true, currentLevel: 3 });
  });

  it('synchronises selected resources, settles overdue lab work, shows legacy active work, and does not alter research rows', async () => {
    const owner = await player('research-settle', { researchLab: 0 });
    await prisma.buildQueueItem.create({ data: { planetId: owner.first.id, buildingKey: 'researchLab', targetLevel: 1, costAlloy: 250, costHeliox: 400, costAether: 100, startedAt: new Date(NOW.getTime() - 2000), completesAt: new Date(NOW.getTime() - 1000) } });
    await prisma.research.create({ data: { userId: owner.user.id, key: 'weaponTech', level: 1 } });
    await prisma.researchQueueItem.create({ data: { userId: owner.user.id, planetId: owner.second.id, researchKey: 'weaponTech', targetLevel: 2, costAlloy: 510, costHeliox: 510, costAether: 68, durationSeconds: 60, completesAt: new Date(NOW.getTime() + 60000) } });
    const before = await prisma.research.findMany({ where: { userId: owner.user.id } });
    const response = await request(app).get(`/api/research?planetId=${owner.first.id}`).set('Cookie', owner.cookie).expect(200);
    expect(response.body.selectedPlanet.researchLabLevel).toBe(1);
    expect(response.body.selectedPlanet.resources.alloy).toBeGreaterThan(500);
    expect(response.body.activeResearch).toMatchObject({ id: 'weaponTech', targetLevel: 2 });
    expect(response.body.activeResearch).not.toHaveProperty('jobId');
    expect(await prisma.research.findMany({ where: { userId: owner.user.id } })).toEqual(before);
  });

  it('settles an overdue item once on an owned catalogue read without allowing another player to trigger it', async () => {
    const owner = await player('research-fallback', { researchLab: 3 });
    const other = await player('research-fallback-other');
    const item = await prisma.researchQueueItem.create({ data: { userId: owner.user.id, planetId: owner.first.id, researchKey: 'weaponTech', targetLevel: 2, costAlloy: 1, costHeliox: 1, costAether: 1, durationSeconds: 1, startedAt: new Date(NOW.getTime() - 2_000), completesAt: new Date(NOW.getTime() - 1_000) } });
    await request(app).get(`/api/research?planetId=${owner.first.id}`).set('Cookie', other.cookie).expect(404);
    expect(await prisma.researchQueueItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: 'PENDING' });
    await request(app).get(`/api/research?planetId=${owner.first.id}`).set('Cookie', owner.cookie).expect(200);
    await request(app).get(`/api/research?planetId=${owner.first.id}`).set('Cookie', owner.cookie).expect(200);
    expect(await prisma.research.findUniqueOrThrow({ where: { userId_key: { userId: owner.user.id, key: 'weaponTech' } } })).toMatchObject({ level: 2 });
    expect(await prisma.notification.count({ where: { userId: owner.user.id, type: 'RESEARCH_COMPLETE' } })).toBe(1);
  });
});
