import { EspionageProbeDisclosureTier, Prisma } from '@prisma/client';
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
      galaxy: 2,
      system: 40,
      slot: nextSlot++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
    },
  });
}

async function canonicalProbeMission(options: {
  origin: { id: string; ownerId: string };
  target: { id: string; ownerId: string };
}) {
  return prisma.fleetMission.create({
    data: {
      originId: options.origin.id,
      targetId: options.target.id,
      targetGalaxy: 2,
      targetSystem: 40,
      targetSlot: 12,
      missionType: 'ESPIONAGE',
      ships: { legacy: 'ignored' },
      cargo: { legacy: 'ignored' },
      speedPercent: 100,
      departedAt: new Date('2026-12-01T00:00:00.000Z'),
      arrivesAt: new Date('2026-12-01T00:01:00.000Z'),
      returnsAt: new Date('2026-12-01T00:02:00.000Z'),
      status: 'OUTBOUND',
      espionageOriginPlanetId: options.origin.id,
      espionageTargetPlanetId: options.target.id,
      espionageOriginAccountId: options.origin.ownerId,
      espionageTargetAccountId: options.target.ownerId,
      espionageProbeShips: { probe: 1 },
      espionageOutboundFuelHeliox: 11,
      espionageReturnFuelHeliox: 11,
      espionageOutboundDurationSeconds: 60,
      espionageReturnDurationSeconds: 60,
      espionageProbePhase: 'OUTBOUND',
    },
  });
}

function disclosureSnapshot() {
  return {
    target: {
      coordinates: { galaxy: 2, system: 40, slot: 7 },
      planetName: 'Aster Vale',
      planetType: 'temperate',
      ownerUsername: 'target',
    },
    tier: 'FORCES',
    resources: { alloy: 1200, heliox: 800, aether: 75 },
    buildings: { alloyMine: 4 },
    ships: { probe: 1 },
    defences: { flakTurret: 2 },
  };
}

async function canonicalReport(options: {
  missionId: string;
  attackerId: string;
  targetPlanetId: string;
  tier?: EspionageProbeDisclosureTier;
}) {
  return prisma.espionageProbeReport.create({
    data: {
      missionId: options.missionId,
      attackerId: options.attackerId,
      targetPlanetId: options.targetPlanetId,
      createdAt: new Date('2026-12-01T00:01:00.000Z'),
      tier: options.tier ?? 'FORCES',
      disclosureSnapshot: disclosureSnapshot(),
    },
  });
}

beforeEach(() => {
  nextSlot = 1;
});

describe('canonical Espionage Probe report persistence', () => {
  it('records the migration while preserving representative legacy FleetMission and raw EspionageReport fields', async () => {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT "migration_name" FROM "_prisma_migrations"
      WHERE "migration_name" = '20260911130000_add_espionage_probe_reports'
    `;
    expect(migrations).toEqual([{ migration_name: '20260911130000_add_espionage_probe_reports' }]);

    const account = await player('probe-report-legacy');
    const origin = await planet(account.id, 'Origin');
    const target = await planet(account.id, 'Target');
    const legacyMission = await prisma.fleetMission.create({
      data: {
        originId: origin.id,
        targetId: target.id,
        targetGalaxy: 2,
        targetSystem: 40,
        targetSlot: 7,
        missionType: 'ESPIONAGE',
        ships: { legacy: 'ships' },
        cargo: { legacy: 'cargo' },
        speedPercent: 37,
        arrivesAt: new Date('2026-12-01T00:01:00.000Z'),
        status: 'RETURNING',
        jobId: 'legacy-job',
        resultSummary: { legacy: 'result' },
      },
    });
    const legacyReport = await prisma.espionageReport.create({
      data: {
        missionId: legacyMission.id,
        ownerId: account.id,
        targetPlanetId: target.id,
        accuracy: 0.5,
        data: { legacy: 'raw-report' },
      },
    });

    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: legacyMission.id } })).toMatchObject({
      ships: { legacy: 'ships' }, cargo: { legacy: 'cargo' }, speedPercent: 37,
      status: 'RETURNING', jobId: 'legacy-job', resultSummary: { legacy: 'result' },
    });
    expect(await prisma.espionageReport.findUniqueOrThrow({ where: { id: legacyReport.id } })).toMatchObject({
      missionId: legacyMission.id, ownerId: account.id, targetPlanetId: target.id,
      accuracy: 0.5, data: { legacy: 'raw-report' },
    });
    await expect(prisma.espionageProbeReport.create({
      data: {
        missionId: legacyMission.id,
        attackerId: account.id,
        targetPlanetId: target.id,
        createdAt: new Date('2026-12-01T00:01:00.000Z'),
        tier: 'IDENTITY',
        disclosureSnapshot: { target: {}, tier: 'IDENTITY' },
      },
    })).rejects.toThrow('EspionageProbeReport requires a canonical Espionage Probe mission');
    expect(await prisma.espionageProbeReport.count()).toBe(0);
  });

  it('persists a separate typed, relational, immutable canonical report', async () => {
    const attacker = await player('probe-report-attacker');
    const defender = await player('probe-report-defender');
    const origin = await planet(attacker.id, 'Origin');
    const target = await planet(defender.id, 'Target');
    const mission = await canonicalProbeMission({ origin, target });

    const report = await canonicalReport({ missionId: mission.id, attackerId: attacker.id, targetPlanetId: target.id });
    expect(report).toMatchObject({
      missionId: mission.id,
      attackerId: attacker.id,
      targetPlanetId: target.id,
      createdAt: new Date('2026-12-01T00:01:00.000Z'),
      tier: 'FORCES',
      disclosureSnapshot: disclosureSnapshot(),
    });
    expect(await prisma.espionageReport.count()).toBe(0);
    await expect(prisma.espionageProbeReport.update({
      where: { id: report.id },
      data: { tier: 'IDENTITY' },
    })).rejects.toThrow('EspionageProbeReport rows are immutable');
  });

  it('enforces one canonical report per mission while permitting distinct canonical Probe missions', async () => {
    const attacker = await player('probe-report-unique-attacker');
    const defender = await player('probe-report-unique-defender');
    const origin = await planet(attacker.id, 'Origin');
    const target = await planet(defender.id, 'Target');
    const secondOrigin = await planet(attacker.id, 'Second origin');
    const secondTarget = await planet(defender.id, 'Second target');
    const firstMission = await canonicalProbeMission({ origin, target });
    const secondMission = await canonicalProbeMission({ origin: secondOrigin, target: secondTarget });

    await canonicalReport({ missionId: firstMission.id, attackerId: attacker.id, targetPlanetId: target.id });
    await expect(canonicalReport({ missionId: firstMission.id, attackerId: attacker.id, targetPlanetId: target.id }))
      .rejects.toMatchObject({ code: 'P2002' } as Partial<Prisma.PrismaClientKnownRequestError>);
    await expect(canonicalReport({ missionId: secondMission.id, attackerId: attacker.id, targetPlanetId: secondTarget.id, tier: 'IDENTITY' }))
      .resolves.toMatchObject({ missionId: secondMission.id, tier: 'IDENTITY' });
  });

  it('enforces report foreign keys and cascades canonical reports with their mission, attacker, or target', async () => {
    const attacker = await player('probe-report-cascade-attacker');
    const defender = await player('probe-report-cascade-defender');
    const origin = await planet(attacker.id, 'Origin');
    const target = await planet(defender.id, 'Target');
    const mission = await canonicalProbeMission({ origin, target });
    const report = await canonicalReport({ missionId: mission.id, attackerId: attacker.id, targetPlanetId: target.id });

    // The canonical-mission trigger deliberately runs before this row can
    // reach the mission foreign key; named constraints and real cascade paths
    // are asserted below through the schema catalog and deletions.
    await expect(prisma.espionageProbeReport.create({
      data: {
        missionId: 'missing-mission', attackerId: attacker.id, targetPlanetId: target.id,
        createdAt: new Date(), tier: 'IDENTITY', disclosureSnapshot: {},
      },
    })).rejects.toThrow('EspionageProbeReport requires a canonical Espionage Probe mission');

    await prisma.fleetMission.delete({ where: { id: mission.id } });
    expect(await prisma.espionageProbeReport.findUnique({ where: { id: report.id } })).toBeNull();

    const secondMission = await canonicalProbeMission({ origin, target });
    const secondReport = await canonicalReport({ missionId: secondMission.id, attackerId: attacker.id, targetPlanetId: target.id });
    await prisma.planet.delete({ where: { id: target.id } });
    expect(await prisma.espionageProbeReport.findUnique({ where: { id: secondReport.id } })).toBeNull();

    const finalAttacker = await player('probe-report-final-attacker');
    const finalDefender = await player('probe-report-final-defender');
    const finalOrigin = await planet(finalAttacker.id, 'Final origin');
    const finalTarget = await planet(finalDefender.id, 'Final target');
    const finalMission = await canonicalProbeMission({ origin: finalOrigin, target: finalTarget });
    const finalReport = await canonicalReport({
      missionId: finalMission.id,
      attackerId: finalAttacker.id,
      targetPlanetId: finalTarget.id,
    });
    await prisma.user.delete({ where: { id: finalAttacker.id } });
    expect(await prisma.espionageProbeReport.findUnique({ where: { id: finalReport.id } })).toBeNull();
  });

  it('exposes only the named canonical report constraints and lookup indexes', async () => {
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT "conname" FROM "pg_constraint"
      WHERE "conname" IN (
        'EspionageProbeReport_missionId_fkey',
        'EspionageProbeReport_attackerId_fkey',
        'EspionageProbeReport_targetPlanetId_fkey'
      )
    `;
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT "indexname" FROM "pg_indexes"
      WHERE "schemaname" = 'public' AND "tablename" = 'EspionageProbeReport'
        AND "indexname" IN (
          'EspionageProbeReport_missionId_key',
          'EspionageProbeReport_attackerId_createdAt_idx',
          'EspionageProbeReport_targetPlanetId_idx'
        )
    `;
    expect(constraints.map((constraint) => constraint.conname).sort()).toEqual([
      'EspionageProbeReport_attackerId_fkey',
      'EspionageProbeReport_missionId_fkey',
      'EspionageProbeReport_targetPlanetId_fkey',
    ]);
    expect(indexes.map((index) => index.indexname).sort()).toEqual([
      'EspionageProbeReport_attackerId_createdAt_idx',
      'EspionageProbeReport_missionId_key',
      'EspionageProbeReport_targetPlanetId_idx',
    ]);
  });
});
