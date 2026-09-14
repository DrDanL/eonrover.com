import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { corvetteStrikeArrivalQueue } from '../lib/redis';

const app = createApp();
let fixture = 0;

async function player(label: string) {
  const user = await prisma.user.create({ data: { email: `${label}-${fixture}@example.invalid`, username: `${label}-${fixture}`, passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const token = `corvette-report-${user.id}`;
  await prisma.session.create({ data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function planet(ownerId: string, name: string, system: number, slot: number) {
  return prisma.planet.create({ data: { ownerId, name, galaxy: 1, system, slot, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 300, heliox: 200, aether: 100, lastProductionAt: new Date() } });
}

function snapshot(target: { galaxy: number; system: number; slot: number; name: string }) {
  return {
    target: { coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot }, planet: { name: target.name, type: 'TEMPERATE' } },
    outcome: 'attacker',
    starting: { attacker: { corvette: 2 }, defender: { scout: 1, flakTurret: 2 } },
    survivors: { attacker: { corvette: 1 }, defender: { flakTurret: 1 } },
    losses: { attacker: { corvette: 1 }, defender: { scout: 1, flakTurret: 1 } },
    rounds: [{ round: 1, attackerLosses: { corvette: 1 }, defenderLosses: { scout: 1, flakTurret: 1 } }],
  };
}

async function reportFixture(options: { attacker?: Awaited<ReturnType<typeof player>>; createdAt?: Date } = {}) {
  fixture += 1;
  const attacker = options.attacker ?? await player('combat-attacker');
  const defender = await player('combat-defender');
  const origin = await planet(attacker.user.id, 'Attack Origin', 200 + fixture * 10, 1);
  const target = await planet(defender.user.id, 'Historical Target', 201 + fixture * 10, 2);
  const now = options.createdAt ?? new Date(`2026-09-${String(fixture).padStart(2, '0')}T00:00:00.000Z`);
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: target.id, targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot,
    missionType: 'ATTACK', ships: {}, cargo: {}, speedPercent: 100, departedAt: new Date(now.getTime() - 120_000), arrivesAt: new Date(now.getTime() - 60_000), returnsAt: now, status: 'COMPLETE',
    corvetteStrikeOriginPlanetId: origin.id, corvetteStrikeTargetPlanetId: target.id, corvetteStrikeAttackerId: attacker.user.id, corvetteStrikeDefenderId: defender.user.id,
    corvetteStrikeShips: { corvette: 2 }, corvetteStrikeOutboundFuelHeliox: 1, corvetteStrikeReturnFuelHeliox: 1, corvetteStrikeOutboundDurationSeconds: 60, corvetteStrikeReturnDurationSeconds: 60,
    corvetteStrikeResolverVersion: 'corvette-strike-v1', corvetteStrikeResolverSeed: 'a'.repeat(64), corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, corvetteStrikePhase: 'COMPLETE',
  } });
  const report = await prisma.corvetteStrikeReport.create({ data: { missionId: mission.id, attackerId: attacker.user.id, defenderId: defender.user.id, createdAt: now, resolverVersion: 'corvette-strike-v1', resultSnapshot: snapshot(target) as Prisma.InputJsonValue } });
  return { attacker, defender, origin, target, mission, report };
}

describe('player-safe canonical Corvette strike reports API', () => {
  beforeEach(() => { fixture = 0; });

  it('requires authentication and applies bounded stable descending pagination', async () => {
    const attacker = await player('report-attacker');
    await request(app).get('/api/combat/strikes/reports').expect(401);
    const old = await reportFixture({ attacker, createdAt: new Date('2026-09-01T00:00:00.000Z') });
    const newestA = await reportFixture({ attacker, createdAt: new Date('2026-09-02T00:00:00.000Z') });
    const newestB = await reportFixture({ attacker, createdAt: new Date('2026-09-02T00:00:00.000Z') });
    const response = await request(app).get('/api/combat/strikes/reports').set('Cookie', attacker.cookie).expect(200);
    expect(response.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(response.body.reports.map((row: { id: string }) => row.id)).toEqual([newestA.report.id, newestB.report.id].sort().concat(old.report.id));
    await request(app).get('/api/combat/strikes/reports?page=0').set('Cookie', attacker.cookie).expect(400);
    await request(app).get('/api/combat/strikes/reports?pageSize=51').set('Cookie', attacker.cookie).expect(400);
  });

  it('allows only the attacker, and projects exact immutable allowlists without live target state', async () => {
    const data = await reportFixture();
    const stranger = await player('report-stranger');
    const other = await request(app).get(`/api/combat/strikes/reports/${data.report.id}`).set('Cookie', stranger.cookie).expect(404);
    const missing = await request(app).get('/api/combat/strikes/reports/00000000-0000-4000-8000-000000000000').set('Cookie', stranger.cookie).expect(404);
    expect(other.body).toEqual(missing.body);
    await prisma.planet.update({ where: { id: data.target.id }, data: { name: 'Changed Target', alloy: 99_999, heliox: 99_999 } });
    const detail = await request(app).get(`/api/combat/strikes/reports/${data.report.id}`).set('Cookie', data.attacker.cookie).expect(200);
    expect(detail.body).toEqual({
      id: data.report.id, createdAt: data.report.createdAt.toISOString(),
      target: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot, planet: { name: 'Historical Target', type: 'TEMPERATE' } },
      outcome: 'attacker', attacker: { startingCorvettes: 2, lostCorvettes: 1, survivingCorvettes: 1 },
      defender: {
        ships: { starting: { scout: 1 }, lost: { scout: 1 }, surviving: {} },
        defences: { starting: { flakTurret: 2 }, lost: { flakTurret: 1 }, surviving: { flakTurret: 1 } },
      },
      rounds: [{ round: 1, attackerLostCorvettes: 1, defenderLostUnits: 2 }],
    });
    const list = await request(app).get('/api/combat/strikes/reports').set('Cookie', data.attacker.cookie).expect(200);
    expect(Object.keys(list.body.reports[0]).sort()).toEqual(['attacker', 'createdAt', 'defender', 'id', 'outcome', 'target']);
    const serialized = JSON.stringify({ list: list.body, detail: detail.body });
    for (const hidden of [data.mission.id, data.target.id, data.attacker.user.id, data.defender.user.id, 'seed', 'resolverVersion', 'fuel', 'duration', 'jobId', 'resultSnapshot']) expect(serialized).not.toContain(hidden);
  });

  it('is read-only and preserves raw legacy combat-report containment', async () => {
    const data = await reportFixture();
    const before = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } }),
      prisma.notification.count(),
      corvetteStrikeArrivalQueue.getJobCounts(),
    ]);
    const add = jest.spyOn(corvetteStrikeArrivalQueue, 'add');
    try {
      await request(app).get('/api/combat/strikes/reports').set('Cookie', data.attacker.cookie).expect(200);
      await request(app).get(`/api/combat/strikes/reports/${data.report.id}`).set('Cookie', data.attacker.cookie).expect(200);
      await request(app).get('/api/reports/combat').set('Cookie', data.attacker.cookie).expect(503, { error: 'Reports are temporarily unavailable.', code: 'REPORTS_UNAVAILABLE' });
      expect(add).not.toHaveBeenCalled();
    } finally { add.mockRestore(); }
    const after = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } }),
      prisma.notification.count(),
      corvetteStrikeArrivalQueue.getJobCounts(),
    ]);
    expect(after).toEqual(before);
  });
});
