import { CorvetteStrikePhase, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

let nextSlot = 1;

async function player(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}@example.invalid`,
      username: label,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
}

async function planet(ownerId: string, label: string) {
  return prisma.planet.create({
    data: {
      ownerId,
      name: label,
      galaxy: 1,
      system: 80,
      slot: nextSlot++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
    },
  });
}

async function strike(options: {
  origin: { id: string; ownerId: string };
  target: { id: string; ownerId: string };
  phase?: CorvetteStrikePhase;
  canonical?: boolean;
}) {
  const canonical = options.canonical ?? true;
  return prisma.fleetMission.create({
    data: {
      originId: options.origin.id,
      targetId: options.target.id,
      targetGalaxy: 1,
      targetSystem: 80,
      targetSlot: 12,
      missionType: 'ATTACK',
      ships: { legacy: 'unchanged' },
      cargo: { legacy: 'unchanged' },
      speedPercent: 37,
      departedAt: new Date('2026-12-01T00:00:00.000Z'),
      arrivesAt: new Date('2026-12-01T00:01:00.000Z'),
      returnsAt: new Date('2026-12-01T00:02:00.000Z'),
      status: 'RETURNING',
      jobId: 'legacy-job-id',
      resultSummary: { legacy: 'unchanged' },
      ...(canonical ? {
        corvetteStrikeOriginPlanetId: options.origin.id,
        corvetteStrikeTargetPlanetId: options.target.id,
        corvetteStrikeAttackerId: options.origin.ownerId,
        corvetteStrikeDefenderId: options.target.ownerId,
        corvetteStrikeShips: { corvette: 2 },
        corvetteStrikeOutboundFuelHeliox: 21,
        corvetteStrikeReturnFuelHeliox: 21,
        corvetteStrikeOutboundDurationSeconds: 60,
        corvetteStrikeReturnDurationSeconds: 60,
        corvetteStrikeResolverVersion: 'corvette-strike-v1',
        corvetteStrikeResolverSeed: 'a'.repeat(64),
        corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 },
        corvetteStrikePhase: options.phase ?? 'OUTBOUND',
      } : {}),
    },
  });
}

beforeEach(() => {
  nextSlot = 1;
});

describe('canonical Corvette strike persistence', () => {
  it('records the migration while legacy ATTACK fields remain unchanged and non-canonical', async () => {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT "migration_name" FROM "_prisma_migrations"
      WHERE "migration_name" = '20260913100000_add_corvette_strike_snapshots'
    `;
    expect(migrations).toEqual([{ migration_name: '20260913100000_add_corvette_strike_snapshots' }]);

    const account = await player('strike-legacy');
    const origin = await planet(account.id, 'Origin');
    const target = await planet(account.id, 'Target');
    const legacy = await strike({ origin, target, canonical: false });

    expect(legacy).toMatchObject({
      ships: { legacy: 'unchanged' },
      cargo: { legacy: 'unchanged' },
      speedPercent: 37,
      status: 'RETURNING',
      jobId: 'legacy-job-id',
      resultSummary: { legacy: 'unchanged' },
      corvetteStrikeOriginPlanetId: null,
      corvetteStrikeTargetPlanetId: null,
      corvetteStrikeAttackerId: null,
      corvetteStrikeDefenderId: null,
      corvetteStrikeShips: null,
      corvetteStrikeOutboundFuelHeliox: null,
      corvetteStrikeReturnFuelHeliox: null,
      corvetteStrikeOutboundDurationSeconds: null,
      corvetteStrikeReturnDurationSeconds: null,
      corvetteStrikeResolverVersion: null,
      corvetteStrikeResolverSeed: null,
      corvetteStrikeAttackerTechnology: null,
      corvetteStrikePhase: null,
    });
  });

  it('persists canonical snapshots and enforces the named active-origin invariant', async () => {
    const attacker = await player('strike-origin');
    const defender = await player('strike-defender');
    const origin = await planet(attacker.id, 'Origin');
    const firstTarget = await planet(defender.id, 'First target');
    const secondTarget = await planet(defender.id, 'Second target');
    const mission = await strike({ origin, target: firstTarget });

    expect(mission).toMatchObject({
      corvetteStrikeOriginPlanetId: origin.id,
      corvetteStrikeTargetPlanetId: firstTarget.id,
      corvetteStrikeAttackerId: attacker.id,
      corvetteStrikeDefenderId: defender.id,
      corvetteStrikeShips: { corvette: 2 },
      corvetteStrikePhase: 'OUTBOUND',
    });
    await expect(strike({ origin, target: secondTarget, phase: 'RETURNING' }))
      .rejects.toMatchObject({ code: 'P2002' } as Partial<Prisma.PrismaClientKnownRequestError>);
    await expect(strike({ origin, target: secondTarget, phase: 'COMPLETE' }))
      .resolves.toMatchObject({ corvetteStrikePhase: 'COMPLETE' });

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT "indexname" FROM "pg_indexes"
      WHERE "schemaname" = 'public' AND "tablename" = 'FleetMission'
        AND "indexname" = 'FleetMission_one_active_canonical_corvette_strike_per_origin'
    `;
    expect(indexes).toEqual([{ indexname: 'FleetMission_one_active_canonical_corvette_strike_per_origin' }]);
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT "conname" FROM "pg_constraint"
      WHERE "conname" IN (
        'FleetMission_corvetteStrikeOriginPlanetId_fkey',
        'FleetMission_corvetteStrikeTargetPlanetId_fkey',
        'FleetMission_corvetteStrikeAttackerId_fkey',
        'FleetMission_corvetteStrikeDefenderId_fkey'
      )
    `;
    expect(constraints.map((constraint) => constraint.conname).sort()).toEqual([
      'FleetMission_corvetteStrikeAttackerId_fkey',
      'FleetMission_corvetteStrikeDefenderId_fkey',
      'FleetMission_corvetteStrikeOriginPlanetId_fkey',
      'FleetMission_corvetteStrikeTargetPlanetId_fkey',
    ]);
  });

  it('keeps the future canonical report relational, unique, and independent of legacy report rows', async () => {
    const attacker = await player('strike-report-attacker');
    const defender = await player('strike-report-defender');
    const origin = await planet(attacker.id, 'Origin');
    const target = await planet(defender.id, 'Target');
    const mission = await strike({ origin, target });
    const report = await prisma.corvetteStrikeReport.create({
      data: {
        missionId: mission.id,
        attackerId: attacker.id,
        defenderId: defender.id,
        createdAt: new Date('2026-12-01T00:01:00.000Z'),
        resolverVersion: 'corvette-strike-v1',
        resultSnapshot: { outcome: 'draw' },
      },
    });
    expect(report).toMatchObject({ missionId: mission.id, attackerId: attacker.id, defenderId: defender.id });
    await expect(prisma.corvetteStrikeReport.create({
      data: {
        missionId: mission.id,
        attackerId: attacker.id,
        defenderId: defender.id,
        createdAt: new Date(),
        resolverVersion: 'corvette-strike-v1',
        resultSnapshot: {},
      },
    })).rejects.toMatchObject({ code: 'P2002' } as Partial<Prisma.PrismaClientKnownRequestError>);
    expect(await prisma.combatReport.count()).toBe(0);
  });
});
