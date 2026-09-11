import { prisma } from '../lib/prisma';
import { fleetQueue } from '../lib/redis';
import { launchCanonicalEspionageProbe } from './espionageProbeLaunchService';
import { settleCanonicalEspionageProbe } from './espionageProbeCompletionService';

let sequence = 0;

async function createUser(label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      email: `${label}-${sequence}@example.invalid`,
      username: `${label}-${sequence}`,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
}

async function createPlanet(ownerId: string, name: string, system: number, slot: number) {
  return prisma.planet.create({
    data: {
      ownerId,
      name,
      galaxy: 1,
      system,
      slot,
      planetType: 'TEMPERATE',
      temperature: 15,
      solarIndex: 0.8,
      alloy: 1_000,
      heliox: 1_000,
      aether: 1_000,
      lastProductionAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
}

async function fixture() {
  const attacker = await createUser('probe-attacker');
  const defender = await createUser('probe-defender');
  const origin = await createPlanet(attacker.id, 'Origin', 100 + sequence, 1);
  const target = await createPlanet(defender.id, 'Target', 101 + sequence, 2);
  await prisma.$transaction([
    prisma.research.create({ data: { userId: attacker.id, key: 'espionageTech', level: 5 } }),
    prisma.research.create({ data: { userId: defender.id, key: 'espionageTech', level: 0 } }),
    prisma.ship.create({ data: { planetId: origin.id, key: 'probe', count: 1 } }),
    prisma.ship.create({ data: { planetId: target.id, key: 'scout', count: 3 } }),
    prisma.defence.create({ data: { planetId: target.id, key: 'flakTurret', count: 2 } }),
    prisma.building.create({ data: { planetId: target.id, key: 'solarArray', level: 3 } }),
    prisma.building.create({ data: { planetId: target.id, key: 'alloyMine', level: 2 } }),
    prisma.building.create({ data: { planetId: target.id, key: 'alloyStorage', level: 5 } }),
  ]);
  const accepted = await launchCanonicalEspionageProbe({
    userId: attacker.id,
    originPlanetId: origin.id,
    target: { galaxy: target.galaxy, system: target.system, slot: target.slot },
  });
  return { attacker, defender, origin, target, accepted };
}

async function readMission(id: string) {
  return prisma.fleetMission.findUniqueOrThrow({ where: { id } });
}

describe('settleCanonicalEspionageProbe', () => {
  it('keeps an early canonical Probe entirely unchanged', async () => {
    const data = await fixture();
    const [beforeMission, beforeOrigin, beforeTarget, beforeQueue] = await Promise.all([
      readMission(data.accepted.missionId),
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.target.id } }),
      fleetQueue.getJobCounts(),
    ]);

    await expect(settleCanonicalEspionageProbe(data.accepted.missionId, new Date(data.accepted.arrivesAt.getTime() - 1))).resolves.toBe('early');

    expect(await readMission(data.accepted.missionId)).toMatchObject({ id: beforeMission.id, espionageProbePhase: 'OUTBOUND', status: 'OUTBOUND' });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).toMatchObject({ heliox: beforeOrigin.heliox });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.target.id } })).toMatchObject({ alloy: beforeTarget.alloy, heliox: beforeTarget.heliox, aether: beforeTarget.aether });
    expect(await prisma.espionageProbeReport.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(await fleetQueue.getJobCounts()).toEqual(beforeQueue);
  });

  it('settles target production at arrival, stores one filtered report, and keeps the Probe reserved until return', async () => {
    const data = await fixture();
    const targetBefore = await prisma.planet.findUniqueOrThrow({ where: { id: data.target.id } });

    await expect(settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.arrivesAt)).resolves.toBe('arrived');

    const [mission, report, target, originProbe, notifications] = await Promise.all([
      readMission(data.accepted.missionId),
      prisma.espionageProbeReport.findUniqueOrThrow({ where: { missionId: data.accepted.missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.target.id } }),
      prisma.ship.findUnique({ where: { planetId_key: { planetId: data.origin.id, key: 'probe' } } }),
      prisma.notification.findMany({ orderBy: { type: 'asc' } }),
    ]);
    expect(mission).toMatchObject({ espionageProbePhase: 'RETURNING', status: 'RETURNING' });
    expect(target.lastProductionAt.getTime()).toBe(data.accepted.arrivesAt.getTime());
    expect(target.alloy).toBeGreaterThan(targetBefore.alloy);
    expect(originProbe?.count ?? 0).toBe(0);
    expect(report).toMatchObject({ attackerId: data.attacker.id, targetPlanetId: data.target.id, tier: 'FORCES' });
    expect(report.disclosureSnapshot).toMatchObject({
      target: { coordinates: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot }, planetName: 'Target', ownerUsername: data.defender.username },
      tier: 'FORCES',
      resources: expect.any(Object),
      buildings: { alloyMine: 2, solarArray: 3, alloyStorage: 5 },
      ships: { scout: 3 },
      defences: { flakTurret: 2 },
    });
    const serialized = JSON.stringify(report.disclosureSnapshot);
    for (const sensitive of [data.attacker.id, data.defender.id, data.target.id, data.origin.id, 'passwordHash', 'email', 'jobId', 'lastProductionAt']) {
      expect(serialized).not.toContain(sensitive);
    }
    expect(notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: data.attacker.id, type: 'ESPIONAGE_REPORT_READY' }),
      expect.objectContaining({ userId: data.defender.id, type: 'ESPIONAGE_DETECTED' }),
    ]));
    expect(notifications).toHaveLength(2);
  });

  it('restores exactly one Probe only at the persisted return time, including a missing inventory row', async () => {
    const data = await fixture();
    await settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.arrivesAt);
    await prisma.ship.deleteMany({ where: { planetId: data.origin.id, key: 'probe' } });

    await expect(settleCanonicalEspionageProbe(data.accepted.missionId, new Date(data.accepted.returnsAt.getTime() - 1))).resolves.toBe('early');
    await expect(settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.returnsAt)).resolves.toBe('returned');

    expect(await readMission(data.accepted.missionId)).toMatchObject({ espionageProbePhase: 'COMPLETE', status: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'probe' } } })).toMatchObject({ count: 1 });
    expect(await prisma.espionageProbeReport.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(2);
  });

  it('settles a late delivery through arrival and return exactly once', async () => {
    const data = await fixture();
    await expect(settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.returnsAt)).resolves.toBe('returned');

    expect(await readMission(data.accepted.missionId)).toMatchObject({ espionageProbePhase: 'COMPLETE', status: 'COMPLETE' });
    expect(await prisma.espionageProbeReport.count({ where: { missionId: data.accepted.missionId } })).toBe(1);
    expect(await prisma.notification.count()).toBe(2);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'probe' } } })).toMatchObject({ count: 1 });
  });

  it('is idempotent for duplicate and concurrent arrival and return delivery', async () => {
    const data = await fixture();
    const arrivalResults = await Promise.all([
      settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.arrivesAt),
      settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.arrivesAt),
    ]);
    expect(arrivalResults).toContain('arrived');
    expect(await prisma.espionageProbeReport.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(2);

    const returnResults = await Promise.all([
      settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.returnsAt),
      settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.returnsAt),
    ]);
    expect(returnResults).toContain('returned');
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'probe' } } })).toMatchObject({ count: 1 });
    expect(await prisma.espionageProbeReport.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(2);
  });

  it('leaves legacy, malformed, cancelled, and terminal mission rows harmless', async () => {
    const data = await fixture();
    await settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.returnsAt);
    const malformedOrigin = await createPlanet(data.attacker.id, 'Malformed origin', 200 + sequence, 3);
    const legacy = await prisma.fleetMission.create({
      data: {
        originId: data.origin.id, targetId: data.target.id, targetGalaxy: data.target.galaxy, targetSystem: data.target.system, targetSlot: data.target.slot,
        missionType: 'ESPIONAGE', ships: { probe: 99 }, cargo: { alloy: 99 }, speedPercent: 1,
        arrivesAt: new Date('2026-01-01T00:00:00.000Z'), status: 'OUTBOUND', jobId: 'legacy-probe-job',
      },
    });
    const malformed = await prisma.fleetMission.create({
      data: {
        originId: malformedOrigin.id, targetId: data.target.id, targetGalaxy: data.target.galaxy, targetSystem: data.target.system, targetSlot: data.target.slot,
        missionType: 'ESPIONAGE', ships: { probe: 1 }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100,
        arrivesAt: new Date('2026-01-01T00:00:00.000Z'), returnsAt: new Date('2026-01-01T00:01:00.000Z'), status: 'OUTBOUND',
        espionageOriginPlanetId: malformedOrigin.id, espionageTargetPlanetId: data.target.id,
        espionageOriginAccountId: data.attacker.id, espionageTargetAccountId: data.defender.id,
        espionageProbeShips: { probe: 2 }, espionageOutboundFuelHeliox: 1, espionageReturnFuelHeliox: 1,
        espionageOutboundDurationSeconds: 60, espionageReturnDurationSeconds: 60, espionageProbePhase: 'OUTBOUND',
      },
    });
    const cancelled = await prisma.fleetMission.create({
      data: {
        originId: data.origin.id, targetId: data.target.id, targetGalaxy: data.target.galaxy, targetSystem: data.target.system, targetSlot: data.target.slot,
        missionType: 'ESPIONAGE', ships: { probe: 1 }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100,
        departedAt: new Date('2025-12-31T23:59:00.000Z'), arrivesAt: new Date('2026-01-01T00:00:00.000Z'), returnsAt: new Date('2026-01-01T00:01:00.000Z'), status: 'RECALLED',
        espionageOriginPlanetId: data.origin.id, espionageTargetPlanetId: data.target.id,
        espionageOriginAccountId: data.attacker.id, espionageTargetAccountId: data.defender.id,
        espionageProbeShips: { probe: 1 }, espionageOutboundFuelHeliox: 1, espionageReturnFuelHeliox: 1,
        espionageOutboundDurationSeconds: 60, espionageReturnDurationSeconds: 60, espionageProbePhase: 'OUTBOUND',
      },
    });
    const queueBefore = await fleetQueue.getJobCounts();
    await expect(settleCanonicalEspionageProbe(legacy.id, new Date('2026-02-01T00:00:00.000Z'))).resolves.toBe('noop');
    await expect(settleCanonicalEspionageProbe(malformed.id, new Date('2026-02-01T00:00:00.000Z'))).resolves.toBe('noop');
    await expect(settleCanonicalEspionageProbe(cancelled.id, new Date('2026-02-01T00:00:00.000Z'))).resolves.toBe('noop');
    await expect(settleCanonicalEspionageProbe(data.accepted.missionId, data.accepted.returnsAt)).resolves.toBe('noop');
    expect(await prisma.espionageProbeReport.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(2);
    expect(await fleetQueue.getJobCounts()).toEqual(queueBefore);
  });
});
