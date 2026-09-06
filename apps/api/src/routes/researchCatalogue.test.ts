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
    await prisma.researchQueueItem.create({ data: { planetId: owner.second.id, researchKey: 'weaponTech', targetLevel: 2, completesAt: new Date(NOW.getTime() + 60000) } });
    const before = await prisma.research.findMany({ where: { userId: owner.user.id } });
    const response = await request(app).get(`/api/research?planetId=${owner.first.id}`).set('Cookie', owner.cookie).expect(200);
    expect(response.body.selectedPlanet.researchLabLevel).toBe(1);
    expect(response.body.selectedPlanet.resources.alloy).toBeGreaterThan(500);
    expect(response.body.activeResearch).toMatchObject({ id: 'weaponTech', targetLevel: 2 });
    expect(response.body.activeResearch).not.toHaveProperty('jobId');
    expect(await prisma.research.findMany({ where: { userId: owner.user.id } })).toEqual(before);
  });
});
