import request from 'supertest';
import { EspionageProbeDisclosureTier, Prisma } from '@prisma/client';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { espionageProbeArrivalQueue } from '../lib/redis';

const app = createApp();
let fixture = 0;
let coordinate = 1;

async function player(label: string) {
  const id = `${label}-${fixture}-${coordinate++}`;
  const user = await prisma.user.create({ data: {
    email: `${id}@example.invalid`, username: id, passwordHash: 'not-used',
    status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const token = `probe-report-${user.id}`;
  await prisma.session.create({ data: {
    id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000),
  } });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function planet(ownerId: string, name: string, options: { system?: number; slot?: number } = {}) {
  return prisma.planet.create({ data: {
    ownerId, name, galaxy: 1, system: options.system ?? 100 + fixture, slot: options.slot ?? coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 300, heliox: 200, aether: 100, lastProductionAt: new Date('2026-12-02T00:00:00.000Z'),
  } });
}

function disclosureSnapshot(tier: EspionageProbeDisclosureTier, target: { galaxy: number; system: number; slot: number; name: string }, username: string) {
  const snapshot: Record<string, unknown> = {
    target: {
      coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot },
      planetName: target.name,
      planetType: 'temperate',
      ownerUsername: username,
    },
    tier,
  };
  if (tier === 'IDENTITY') return snapshot;
  snapshot.resources = { alloy: 1200, heliox: 800, aether: 75 };
  if (tier === 'RESOURCES') return snapshot;
  snapshot.buildings = { alloyMine: 4 };
  if (tier === 'BUILDINGS') return snapshot;
  snapshot.ships = { probe: 1 };
  snapshot.defences = { flakTurret: 2 };
  return snapshot;
}

async function canonicalReport(options: {
  attacker: { id: string; username: string };
  targetOwner?: { id: string; username: string };
  tier?: EspionageProbeDisclosureTier;
  createdAt?: Date;
}) {
  const targetOwner = options.targetOwner ?? (await player('report-target')).user;
  const origin = await planet(options.attacker.id, 'Probe Origin', { system: 50 + fixture * 10 + coordinate++, slot: 1 });
  const target = await planet(targetOwner.id, 'Snapshot World', { system: 150 + fixture * 10 + coordinate++, slot: 2 });
  const arrivedAt = new Date('2026-12-02T00:01:00.000Z');
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id,
    targetId: target.id,
    targetGalaxy: target.galaxy,
    targetSystem: target.system,
    targetSlot: target.slot,
    missionType: 'ESPIONAGE',
    ships: { legacy: 'ignored' },
    cargo: { legacy: 'ignored' },
    speedPercent: 100,
    departedAt: new Date(arrivedAt.getTime() - 60_000),
    arrivesAt: arrivedAt,
    returnsAt: new Date(arrivedAt.getTime() + 60_000),
    status: 'COMPLETE',
    espionageOriginPlanetId: origin.id,
    espionageTargetPlanetId: target.id,
    espionageOriginAccountId: options.attacker.id,
    espionageTargetAccountId: targetOwner.id,
    espionageProbeShips: { probe: 1 },
    espionageOutboundFuelHeliox: 10,
    espionageReturnFuelHeliox: 10,
    espionageOutboundDurationSeconds: 60,
    espionageReturnDurationSeconds: 60,
    espionageProbePhase: 'COMPLETE',
  } });
  const tier = options.tier ?? 'FORCES';
  const report = await prisma.espionageProbeReport.create({ data: {
    missionId: mission.id,
    attackerId: options.attacker.id,
    targetPlanetId: target.id,
    createdAt: options.createdAt ?? arrivedAt,
    tier,
    disclosureSnapshot: disclosureSnapshot(tier, target, targetOwner.username) as Prisma.InputJsonValue,
  } });
  return { report, mission, origin, target, targetOwner };
}

beforeEach(() => { fixture += 1; coordinate = 1; });

describe('player-safe canonical Espionage Probe report API', () => {
  it('requires authentication and applies bounded, stable descending pagination', async () => {
    const attacker = await player('report-attacker');
    await request(app).get('/api/espionage/reports').expect(401);
    const older = await canonicalReport({ attacker: attacker.user, createdAt: new Date('2026-12-02T00:00:00.000Z') });
    const newestA = await canonicalReport({ attacker: attacker.user, createdAt: new Date('2026-12-03T00:00:00.000Z') });
    const newestB = await canonicalReport({ attacker: attacker.user, createdAt: new Date('2026-12-03T00:00:00.000Z') });

    const response = await request(app).get('/api/espionage/reports').set('Cookie', attacker.cookie).expect(200);
    expect(response.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(response.body.reports.map((report: { id: string }) => report.id)).toEqual(
      [newestA.report.id, newestB.report.id].sort().concat([older.report.id]),
    );
    await request(app).get('/api/espionage/reports?page=0').set('Cookie', attacker.cookie).expect(400);
    await request(app).get('/api/espionage/reports?pageSize=51').set('Cookie', attacker.cookie).expect(400);
    await request(app).get('/api/espionage/reports?page=1.5').set('Cookie', attacker.cookie).expect(400);
    const paged = await request(app).get('/api/espionage/reports?page=2&pageSize=1').set('Cookie', attacker.cookie).expect(200);
    expect(paged.body).toMatchObject({ page: 2, pageSize: 1, total: 3, reports: [{ id: [newestA.report.id, newestB.report.id].sort()[1] }] });
  });

  it('keeps missing and other-player report details indistinguishable', async () => {
    const owner = await player('report-owner');
    const stranger = await player('report-stranger');
    const report = await canonicalReport({ attacker: owner.user });
    const other = await request(app).get(`/api/espionage/reports/${report.report.id}`).set('Cookie', stranger.cookie).expect(404);
    const missing = await request(app).get('/api/espionage/reports/00000000-0000-4000-8000-000000000000').set('Cookie', stranger.cookie).expect(404);
    expect(other.body).toEqual(missing.body);
    await request(app).get('/api/espionage/reports/not-a-uuid').set('Cookie', owner.cookie).expect(400);
  });

  it('projects exact disclosure tiers through explicit allowlists without internal identities', async () => {
    const attacker = await player('report-tiers');
    const reports = await Promise.all((['IDENTITY', 'RESOURCES', 'BUILDINGS', 'FORCES'] as const)
      .map((tier, index) => canonicalReport({ attacker: attacker.user, tier, createdAt: new Date(`2026-12-0${index + 2}T00:00:00.000Z`) })));
    const list = await request(app).get('/api/espionage/reports').set('Cookie', attacker.cookie).expect(200);
    expect(list.body.reports).toHaveLength(4);
    for (const fixtureReport of reports) {
      const response = await request(app).get(`/api/espionage/reports/${fixtureReport.report.id}`).set('Cookie', attacker.cookie).expect(200);
      const intelligence = response.body.intelligence;
      expect(response.body).toMatchObject({ id: fixtureReport.report.id, tier: fixtureReport.report.tier });
      expect(Object.keys(intelligence).sort()).toEqual(
        fixtureReport.report.tier === 'IDENTITY' ? ['target', 'tier']
          : fixtureReport.report.tier === 'RESOURCES' ? ['resources', 'target', 'tier']
            : fixtureReport.report.tier === 'BUILDINGS' ? ['buildings', 'resources', 'target', 'tier']
              : ['buildings', 'defences', 'resources', 'ships', 'target', 'tier'],
      );
      const serialized = JSON.stringify(response.body);
      for (const internal of [fixtureReport.mission.id, fixtureReport.target.id, fixtureReport.targetOwner.id, attacker.user.id, 'jobId', 'fuelHeliox', 'durationSeconds', 'missionId']) {
        expect(serialized).not.toContain(internal);
      }
    }
    expect(Object.keys(list.body.reports[0]).sort()).toEqual(['createdAt', 'id', 'target', 'tier']);
    expect(JSON.stringify(list.body)).not.toContain('ownerUsername');
  });

  it('uses only the immutable snapshot and performs no game-state or queue mutation on reads', async () => {
    const attacker = await player('report-history');
    const fixtureReport = await canonicalReport({ attacker: attacker.user, tier: 'FORCES' });
    const before = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: fixtureReport.target.id } }),
      prisma.fleetMission.findUniqueOrThrow({ where: { id: fixtureReport.mission.id } }),
      prisma.notification.count(),
      prisma.user.findUniqueOrThrow({ where: { id: attacker.user.id } }),
      espionageProbeArrivalQueue.getJobCounts(),
    ]);
    await prisma.planet.update({ where: { id: fixtureReport.target.id }, data: { name: 'Changed World', alloy: 9_999, heliox: 9_999, aether: 9_999 } });
    await prisma.user.update({ where: { id: fixtureReport.targetOwner.id }, data: { username: `changed-${fixture}` } });
    const queueAdd = jest.spyOn(espionageProbeArrivalQueue, 'add');
    try {
      const detail = await request(app).get(`/api/espionage/reports/${fixtureReport.report.id}`).set('Cookie', attacker.cookie).expect(200);
      await request(app).get('/api/espionage/reports').set('Cookie', attacker.cookie).expect(200);
      expect(detail.body.intelligence.target).toMatchObject({ planetName: 'Snapshot World', ownerUsername: fixtureReport.targetOwner.username });
      expect(detail.body.intelligence.resources).toEqual({ alloy: 1200, heliox: 800, aether: 75 });
      expect(queueAdd).not.toHaveBeenCalled();
    } finally {
      queueAdd.mockRestore();
    }
    const after = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: fixtureReport.target.id } }),
      prisma.fleetMission.findUniqueOrThrow({ where: { id: fixtureReport.mission.id } }),
      prisma.notification.count(),
      prisma.user.findUniqueOrThrow({ where: { id: attacker.user.id } }),
      espionageProbeArrivalQueue.getJobCounts(),
    ]);
    expect(after[0].lastProductionAt).toEqual(before[0].lastProductionAt);
    expect(after[1]).toMatchObject({ status: before[1].status, espionageProbePhase: before[1].espionageProbePhase });
    expect(after[2]).toBe(before[2]);
    expect(after[3].lastActiveAt).toEqual(before[3].lastActiveAt);
    expect(after[4]).toEqual(before[4]);
  });

  it('contains raw legacy player report routes behind the unavailable boundary', async () => {
    const attacker = await player('legacy-report-owner');
    const targetOwner = await player('legacy-report-target');
    const origin = await planet(attacker.user.id, 'Legacy Origin');
    const target = await planet(targetOwner.user.id, 'Legacy Target');
    const legacyMission = await prisma.fleetMission.create({ data: {
      originId: origin.id, targetId: target.id, targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot,
      missionType: 'ESPIONAGE', ships: { raw: 'ships' }, cargo: { raw: 'cargo' }, speedPercent: 10,
      arrivesAt: new Date(), status: 'OUTBOUND', jobId: 'legacy-only',
    } });
    await prisma.espionageReport.create({ data: {
      missionId: legacyMission.id, ownerId: attacker.user.id, targetPlanetId: target.id, accuracy: 0.5, data: { raw: 'legacy-report' },
    } });
    for (const path of ['/api/reports/espionage', '/api/reports/combat']) {
      await request(app).get(path).set('Cookie', attacker.cookie).expect(503, {
        error: 'Reports are temporarily unavailable.', code: 'REPORTS_UNAVAILABLE',
      });
    }
  });
});
