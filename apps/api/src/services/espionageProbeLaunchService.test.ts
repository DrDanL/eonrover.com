import { AccountStatus } from '@prisma/client';
import { planEspionageProbeMission } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import {
  buildQueue,
  colonizationArrivalQueue,
  deployArrivalQueue,
  fleetQueue,
  researchQueue,
  shipyardQueue,
  transportArrivalQueue,
} from '../lib/redis';
import { invalidateUniverseConfigCache } from './gameConfig';
import {
  EspionageProbeLaunchInput,
  launchCanonicalEspionageProbe,
} from './espionageProbeLaunchService';

let coordinate = 1;

beforeEach(() => {
  coordinate = 1;
  invalidateUniverseConfigCache();
});

afterEach(() => {
  invalidateUniverseConfigCache();
});

async function createPlayer(
  label: string,
  options: { status?: AccountStatus; verified?: boolean; protectedUntil?: Date | null } = {},
) {
  return prisma.user.create({
    data: {
      email: `${label}@example.invalid`,
      username: label,
      passwordHash: 'not-used',
      status: options.status ?? 'ACTIVE',
      emailVerifiedAt: options.verified === false ? null : new Date('2026-01-01T00:00:00.000Z'),
      protectedUntil: options.protectedUntil,
    },
  });
}

async function createPlanet(
  ownerId: string,
  name: string,
  options: { galaxy?: number; system?: number; slot?: number; heliox?: number } = {},
) {
  return prisma.planet.create({
    data: {
      ownerId,
      name,
      galaxy: options.galaxy ?? 1,
      system: options.system ?? coordinate++,
      slot: options.slot ?? 1,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 10_000,
      heliox: options.heliox ?? 10_000,
      aether: 1_000,
      lastProductionAt: new Date(),
    },
  });
}

async function fixture(options: { heliox?: number; probes?: number; technology?: number } = {}) {
  const system = 20 + coordinate * 3;
  coordinate += 1;
  const actor = await createPlayer(`probe-actor-${coordinate}`);
  const targetOwner = await createPlayer(`probe-target-${coordinate}`);
  const origin = await createPlanet(actor.id, 'Probe origin', { system, slot: 1, heliox: options.heliox });
  const target = await createPlanet(targetOwner.id, 'Probe target', { system: system + 1, slot: 2 });
  if ((options.probes ?? 1) >= 0) {
    await prisma.ship.create({ data: { planetId: origin.id, key: 'probe', count: options.probes ?? 1 } });
  }
  if ((options.technology ?? 1) >= 0) {
    await prisma.research.create({ data: { userId: actor.id, key: 'espionageTech', level: options.technology ?? 1 } });
  }
  return { actor, targetOwner, origin, target };
}

function input(
  value: Awaited<ReturnType<typeof fixture>>,
  overrides: Partial<EspionageProbeLaunchInput> = {},
): EspionageProbeLaunchInput {
  return {
    userId: value.actor.id,
    originPlanetId: value.origin.id,
    target: { galaxy: value.target.galaxy, system: value.target.system, slot: value.target.slot },
    ...overrides,
  };
}

async function expectServiceError(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toMatchObject({ name: 'EspionageProbeLaunchError', code });
}

async function canonicalProbeMission(
  origin: { id: string; ownerId: string },
  target: { id: string; ownerId: string; galaxy: number; system: number; slot: number },
) {
  return prisma.fleetMission.create({
    data: {
      originId: origin.id,
      targetId: target.id,
      targetGalaxy: target.galaxy,
      targetSystem: target.system,
      targetSlot: target.slot,
      missionType: 'ESPIONAGE',
      ships: { probe: 1 },
      cargo: { alloy: 0, heliox: 0, aether: 0 },
      speedPercent: 100,
      arrivesAt: new Date('2026-12-01T00:01:00.000Z'),
      returnsAt: new Date('2026-12-01T00:02:00.000Z'),
      status: 'OUTBOUND',
      espionageOriginPlanetId: origin.id,
      espionageTargetPlanetId: target.id,
      espionageOriginAccountId: origin.ownerId,
      espionageTargetAccountId: target.ownerId,
      espionageProbeShips: { probe: 1 },
      espionageOutboundFuelHeliox: 1,
      espionageReturnFuelHeliox: 1,
      espionageOutboundDurationSeconds: 60,
      espionageReturnDurationSeconds: 60,
      espionageProbePhase: 'OUTBOUND',
    },
  });
}

async function queueCounts() {
  return Promise.all([
    buildQueue.getJobCounts(),
    researchQueue.getJobCounts(),
    shipyardQueue.getJobCounts(),
    fleetQueue.getJobCounts(),
    deployArrivalQueue.getJobCounts(),
    colonizationArrivalQueue.getJobCounts(),
    transportArrivalQueue.getJobCounts(),
  ]);
}

describe('launchCanonicalEspionageProbe', () => {
  it('persists only canonical Probe snapshots while reserving one Probe and exact round-trip Heliox', async () => {
    const candidate = await fixture();
    const beforeOrigin = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } });
    const beforeTarget = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.target.id } });
    const queuesBefore = await queueCounts();
    const expected = planEspionageProbeMission({
      origin: { galaxy: candidate.origin.galaxy, system: candidate.origin.system, slot: candidate.origin.slot },
      target: { galaxy: candidate.target.galaxy, system: candidate.target.system, slot: candidate.target.slot },
      fleetSpeed: 1,
    });

    const accepted = await launchCanonicalEspionageProbe(input(candidate));
    const [mission, probes, originAfter, targetAfter] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'probe' } } }),
      prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } }),
      prisma.planet.findUniqueOrThrow({ where: { id: candidate.target.id } }),
    ]);

    expect(accepted).toMatchObject({
      originPlanetId: candidate.origin.id,
      target: { galaxy: candidate.target.galaxy, system: candidate.target.system, slot: candidate.target.slot },
      outboundFuelHeliox: expected.outboundFuelHeliox,
      returnFuelHeliox: expected.returnFuelHeliox,
      outboundDurationSeconds: expected.outboundDurationSeconds,
      returnDurationSeconds: expected.returnDurationSeconds,
      phase: 'OUTBOUND',
    });
    expect(accepted.arrivesAt.getTime() - accepted.departedAt.getTime()).toBe(expected.outboundDurationSeconds * 1_000);
    expect(accepted.returnsAt.getTime() - accepted.arrivesAt.getTime()).toBe(expected.returnDurationSeconds * 1_000);
    expect(mission).toMatchObject({
      originId: candidate.origin.id,
      targetId: candidate.target.id,
      targetGalaxy: candidate.target.galaxy,
      targetSystem: candidate.target.system,
      targetSlot: candidate.target.slot,
      missionType: 'ESPIONAGE',
      ships: { probe: 1 },
      cargo: { alloy: 0, heliox: 0, aether: 0 },
      speedPercent: 100,
      status: 'OUTBOUND',
      jobId: null,
      resultSummary: null,
      espionageOriginPlanetId: candidate.origin.id,
      espionageTargetPlanetId: candidate.target.id,
      espionageOriginAccountId: candidate.actor.id,
      espionageTargetAccountId: candidate.targetOwner.id,
      espionageProbeShips: { probe: 1 },
      espionageOutboundFuelHeliox: expected.outboundFuelHeliox,
      espionageReturnFuelHeliox: expected.returnFuelHeliox,
      espionageOutboundDurationSeconds: expected.outboundDurationSeconds,
      espionageReturnDurationSeconds: expected.returnDurationSeconds,
      espionageProbePhase: 'OUTBOUND',
    });
    expect(probes.count).toBe(0);
    expect(originAfter.heliox).toBe(beforeOrigin.heliox - expected.outboundFuelHeliox - expected.returnFuelHeliox);
    expect(targetAfter).toMatchObject({ alloy: beforeTarget.alloy, heliox: beforeTarget.heliox, aether: beforeTarget.aether });
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.combatReport.count()).toBe(0);
    expect(await prisma.espionageReport.count()).toBe(0);
    expect(await queueCounts()).toEqual(queuesBefore);
  });

  it('accepts only coordinate-selected targets and ignores legacy generic ESPIONAGE rows as authority', async () => {
    const candidate = await fixture();
    await prisma.fleetMission.create({
      data: {
        originId: candidate.origin.id,
        targetId: candidate.target.id,
        targetGalaxy: 6,
        targetSystem: 400,
        targetSlot: 12,
        missionType: 'ESPIONAGE',
        ships: { probe: 99 },
        cargo: { alloy: 999 },
        speedPercent: 1,
        arrivesAt: new Date('2026-12-01T00:00:00.000Z'),
        status: 'RETURNING',
        jobId: 'legacy-job',
      },
    });
    await expectServiceError(launchCanonicalEspionageProbe({
      ...input(candidate),
      target: { galaxy: candidate.target.galaxy, system: candidate.target.system, slot: candidate.target.slot, targetPlanetId: candidate.origin.id },
    }), 'INVALID_TARGET');
    await expectServiceError(launchCanonicalEspionageProbe({
      ...input(candidate),
      targetPlanetId: candidate.origin.id,
    } as unknown as EspionageProbeLaunchInput), 'INVALID_TARGET');

    const accepted = await launchCanonicalEspionageProbe(input(candidate));
    const canonical = await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } });
    expect(canonical).toMatchObject({ ships: { probe: 1 }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100, espionageProbeShips: { probe: 1 } });
    expect(await prisma.fleetMission.count()).toBe(2);
  });

  it('rejects unowned origins, own, missing, unavailable, protected, cross-galaxy, and same-coordinate targets without side effects', async () => {
    const candidate = await fixture();
    const other = await createPlayer('probe-unowned-origin');
    const unownedOrigin = await createPlanet(other.id, 'Unowned origin', { galaxy: 1, system: 30, slot: 1 });
    const ownTarget = await createPlanet(candidate.actor.id, 'Own target', { galaxy: 1, system: 22, slot: 3 });
    const unavailableOwner = await createPlayer('probe-unavailable', { status: 'SUSPENDED' });
    const unavailable = await createPlanet(unavailableOwner.id, 'Unavailable target', { galaxy: 1, system: 23, slot: 4 });
    const protectedOwner = await createPlayer('probe-protected', { protectedUntil: new Date(Date.now() + 60_000) });
    const protectedTarget = await createPlanet(protectedOwner.id, 'Protected target', { galaxy: 1, system: 24, slot: 5 });
    const crossGalaxyOwner = await createPlayer('probe-cross-galaxy');
    const crossGalaxyTarget = await createPlanet(crossGalaxyOwner.id, 'Cross galaxy target', {
      galaxy: 2,
      system: candidate.target.system,
      slot: candidate.target.slot,
    });
    const before = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'probe' } } }),
    ]);

    await expectServiceError(launchCanonicalEspionageProbe({ ...input(candidate), originPlanetId: unownedOrigin.id }), 'ORIGIN_NOT_OWNED');
    await expectServiceError(launchCanonicalEspionageProbe({ ...input(candidate), target: { galaxy: ownTarget.galaxy, system: ownTarget.system, slot: ownTarget.slot } }), 'TARGET_UNAVAILABLE');
    await expectServiceError(launchCanonicalEspionageProbe({ ...input(candidate), target: { galaxy: 1, system: 12, slot: 12 } }), 'TARGET_UNAVAILABLE');
    await expectServiceError(launchCanonicalEspionageProbe({ ...input(candidate), target: { galaxy: unavailable.galaxy, system: unavailable.system, slot: unavailable.slot } }), 'TARGET_UNAVAILABLE');
    await expectServiceError(launchCanonicalEspionageProbe({ ...input(candidate), target: { galaxy: protectedTarget.galaxy, system: protectedTarget.system, slot: protectedTarget.slot } }), 'TARGET_PROTECTED');
    await expectServiceError(launchCanonicalEspionageProbe({ ...input(candidate), target: { galaxy: crossGalaxyTarget.galaxy, system: crossGalaxyTarget.system, slot: crossGalaxyTarget.slot } }), 'INVALID_TARGET');
    await expectServiceError(launchCanonicalEspionageProbe({ ...input(candidate), target: { galaxy: candidate.origin.galaxy, system: candidate.origin.system, slot: candidate.origin.slot } }), 'INVALID_TARGET');

    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } })).toMatchObject({ heliox: before[0].heliox });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'probe' } } })).toMatchObject({ count: before[1].count });
  });

  it('rejects missing technology, Probes, or Heliox without mutations', async () => {
    const noTechnology = await fixture({ technology: 0 });
    await expectServiceError(launchCanonicalEspionageProbe(input(noTechnology)), 'MISSING_ESPIONAGE_TECHNOLOGY');

    const noProbe = await fixture({ probes: 0 });
    await expectServiceError(launchCanonicalEspionageProbe(input(noProbe)), 'INSUFFICIENT_PROBES');

    const expected = planEspionageProbeMission({
      origin: { galaxy: noProbe.origin.galaxy, system: noProbe.origin.system, slot: noProbe.origin.slot },
      target: { galaxy: noProbe.target.galaxy, system: noProbe.target.system, slot: noProbe.target.slot },
      fleetSpeed: 1,
    });
    const noFuel = await fixture({ heliox: expected.outboundFuelHeliox + expected.returnFuelHeliox - 1 });
    await expectServiceError(launchCanonicalEspionageProbe(input(noFuel)), 'INSUFFICIENT_HELIOX');

    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: noProbe.origin.id, key: 'probe' } } })).toMatchObject({ count: 0 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: noFuel.origin.id } })).toMatchObject({ heliox: expected.outboundFuelHeliox + expected.returnFuelHeliox - 1 });
  });

  it('rejects an existing active canonical mission before an insufficient-Probe result', async () => {
    const candidate = await fixture({ probes: 0 });
    await canonicalProbeMission(candidate.origin, candidate.target);
    await expectServiceError(launchCanonicalEspionageProbe(input(candidate)), 'ESPIONAGE_IN_PROGRESS');
    expect(await prisma.fleetMission.count()).toBe(1);
  });

  it('serializes concurrent duplicate launches into one canonical reservation', async () => {
    const candidate = await fixture({ probes: 1 });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } });
    const expected = planEspionageProbeMission({
      origin: { galaxy: candidate.origin.galaxy, system: candidate.origin.system, slot: candidate.origin.slot },
      target: { galaxy: candidate.target.galaxy, system: candidate.target.system, slot: candidate.target.slot },
      fleetSpeed: 1,
    });
    const results = await Promise.allSettled([
      launchCanonicalEspionageProbe(input(candidate)),
      launchCanonicalEspionageProbe(input(candidate)),
    ]);
    const successes = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof launchCanonicalEspionageProbe>>> => result.status === 'fulfilled');
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatchObject({ name: 'EspionageProbeLaunchError', code: 'ESPIONAGE_IN_PROGRESS' });
    expect(await prisma.fleetMission.count({ where: { missionType: 'ESPIONAGE', espionageProbePhase: 'OUTBOUND' } })).toBe(1);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'probe' } } })).toMatchObject({ count: 0 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } })).toMatchObject({
      heliox: before.heliox - expected.outboundFuelHeliox - expected.returnFuelHeliox,
    });
  });
});
