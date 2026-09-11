import { EspionageProbeMissionPhase, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

let nextSlot = 1;

async function player(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}@example.invalid`,
      username: label,
      passwordHash: 'not-used',
      status: 'ACTIVE',
    },
  });
}

async function planet(ownerId: string, label: string) {
  return prisma.planet.create({
    data: {
      ownerId,
      name: label,
      galaxy: 1,
      system: 1,
      slot: nextSlot++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
    },
  });
}

async function probeMission(options: {
  origin: { id: string; ownerId: string };
  target: { id: string; ownerId: string };
  phase?: EspionageProbeMissionPhase;
  canonical?: boolean;
}) {
  const canonical = options.canonical ?? true;
  return prisma.fleetMission.create({
    data: {
      originId: options.origin.id,
      targetId: options.target.id,
      targetGalaxy: 1,
      targetSystem: 1,
      targetSlot: 12,
      missionType: 'ESPIONAGE',
      ships: { legacy: 'ignored' },
      cargo: { legacy: 'ignored' },
      speedPercent: 37,
      departedAt: new Date('2026-12-01T00:00:00.000Z'),
      arrivesAt: new Date('2026-12-01T00:01:00.000Z'),
      returnsAt: new Date('2026-12-01T00:02:00.000Z'),
      status: 'RETURNING',
      jobId: 'legacy-job-id',
      resultSummary: { legacy: 'unchanged' },
      ...(canonical ? {
        espionageOriginPlanetId: options.origin.id,
        espionageTargetPlanetId: options.target.id,
        espionageOriginAccountId: options.origin.ownerId,
        espionageTargetAccountId: options.target.ownerId,
        espionageProbeShips: { probe: 1 },
        espionageOutboundFuelHeliox: 11,
        espionageReturnFuelHeliox: 11,
        espionageOutboundDurationSeconds: 60,
        espionageReturnDurationSeconds: 60,
        espionageProbePhase: options.phase ?? 'OUTBOUND',
      } : {}),
    },
  });
}

beforeEach(() => {
  nextSlot = 1;
});

describe('canonical Espionage Probe persistence', () => {
  it('records the fresh migration while leaving representative legacy fields and new canonical fields independent', async () => {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT "migration_name" FROM "_prisma_migrations"
      WHERE "migration_name" = '20260911120000_add_espionage_probe_mission_snapshots'
    `;
    expect(migrations).toEqual([{ migration_name: '20260911120000_add_espionage_probe_mission_snapshots' }]);

    const account = await player('probe-persistence');
    const origin = await planet(account.id, 'Origin');
    const target = await planet(account.id, 'Target');
    const legacy = await probeMission({ origin, target, canonical: false });

    expect(legacy).toMatchObject({
      ships: { legacy: 'ignored' },
      cargo: { legacy: 'ignored' },
      speedPercent: 37,
      status: 'RETURNING',
      jobId: 'legacy-job-id',
      resultSummary: { legacy: 'unchanged' },
      espionageOriginPlanetId: null,
      espionageTargetPlanetId: null,
      espionageOriginAccountId: null,
      espionageTargetAccountId: null,
      espionageProbeShips: null,
      espionageOutboundFuelHeliox: null,
      espionageReturnFuelHeliox: null,
      espionageOutboundDurationSeconds: null,
      espionageReturnDurationSeconds: null,
      espionageProbePhase: null,
    });
  });

  it('persists one complete canonical Probe snapshot while reusing established travel timestamps', async () => {
    const originAccount = await player('probe-origin');
    const targetAccount = await player('probe-target');
    const origin = await planet(originAccount.id, 'Origin');
    const target = await planet(targetAccount.id, 'Target');

    const mission = await probeMission({ origin, target });
    expect(mission).toMatchObject({
      espionageOriginPlanetId: origin.id,
      espionageTargetPlanetId: target.id,
      espionageOriginAccountId: originAccount.id,
      espionageTargetAccountId: targetAccount.id,
      espionageProbeShips: { probe: 1 },
      espionageOutboundFuelHeliox: 11,
      espionageReturnFuelHeliox: 11,
      espionageOutboundDurationSeconds: 60,
      espionageReturnDurationSeconds: 60,
      espionageProbePhase: 'OUTBOUND',
      departedAt: new Date('2026-12-01T00:00:00.000Z'),
      arrivesAt: new Date('2026-12-01T00:01:00.000Z'),
      returnsAt: new Date('2026-12-01T00:02:00.000Z'),
    });
  });

  it('enforces one active canonical Probe per origin while permitting another origin and terminal rows', async () => {
    const account = await player('probe-active');
    const firstOrigin = await planet(account.id, 'First origin');
    const secondOrigin = await planet(account.id, 'Second origin');
    const firstTarget = await planet(account.id, 'First target');
    const secondTarget = await planet(account.id, 'Second target');

    await probeMission({ origin: firstOrigin, target: firstTarget, phase: 'OUTBOUND' });
    await expect(probeMission({
      origin: firstOrigin,
      target: secondTarget,
      phase: 'RETURNING',
    })).rejects.toMatchObject({ code: 'P2002' } as Partial<Prisma.PrismaClientKnownRequestError>);
    await expect(probeMission({
      origin: secondOrigin,
      target: firstTarget,
      phase: 'OUTBOUND',
    })).resolves.toMatchObject({ espionageProbePhase: 'OUTBOUND' });
    await expect(probeMission({
      origin: firstOrigin,
      target: secondTarget,
      phase: 'COMPLETE',
    })).resolves.toMatchObject({ espionageProbePhase: 'COMPLETE' });
  });

  it('enforces canonical foreign keys and exposes named lookup/recovery indexes', async () => {
    const account = await player('probe-indexes');
    const origin = await planet(account.id, 'Origin');
    const target = await planet(account.id, 'Target');
    await expect(prisma.fleetMission.create({
      data: {
        originId: origin.id,
        targetId: target.id,
        targetGalaxy: 1,
        targetSystem: 1,
        targetSlot: 12,
        missionType: 'ESPIONAGE',
        ships: {},
        cargo: {},
        arrivesAt: new Date('2026-12-01T00:01:00.000Z'),
        espionageOriginPlanetId: 'missing-planet',
      },
    })).rejects.toMatchObject({ code: 'P2003' } as Partial<Prisma.PrismaClientKnownRequestError>);

    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT "conname" FROM "pg_constraint"
      WHERE "conname" IN (
        'FleetMission_espionageOriginPlanetId_fkey',
        'FleetMission_espionageTargetPlanetId_fkey',
        'FleetMission_espionageOriginAccountId_fkey',
        'FleetMission_espionageTargetAccountId_fkey'
      )
    `;
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT "indexname" FROM "pg_indexes"
      WHERE "schemaname" = 'public' AND "tablename" = 'FleetMission'
        AND "indexname" IN (
          'FleetMission_espionageOriginPlanetId_espionageProbePhase_idx',
          'FleetMission_espionageTargetPlanetId_idx',
          'FleetMission_espionageOriginAccountId_idx',
          'FleetMission_espionageTargetAccountId_idx',
          'FleetMission_espionageProbePhase_arrivesAt_idx',
          'FleetMission_espionageProbePhase_returnsAt_idx',
          'FleetMission_one_active_canonical_espionage_probe_per_origin'
        )
    `;
    expect(constraints.map((constraint) => constraint.conname).sort()).toEqual([
      'FleetMission_espionageOriginAccountId_fkey',
      'FleetMission_espionageOriginPlanetId_fkey',
      'FleetMission_espionageTargetAccountId_fkey',
      'FleetMission_espionageTargetPlanetId_fkey',
    ]);
    expect(indexes.map((index) => index.indexname).sort()).toEqual([
      'FleetMission_espionageOriginAccountId_idx',
      'FleetMission_espionageOriginPlanetId_espionageProbePhase_idx',
      'FleetMission_espionageProbePhase_arrivesAt_idx',
      'FleetMission_espionageProbePhase_returnsAt_idx',
      'FleetMission_espionageTargetAccountId_idx',
      'FleetMission_espionageTargetPlanetId_idx',
      'FleetMission_one_active_canonical_espionage_probe_per_origin',
    ]);
  });
});
