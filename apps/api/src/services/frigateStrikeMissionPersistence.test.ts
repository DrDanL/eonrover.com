import { FrigateStrikePhase, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

let slot = 1;
async function user(label: string) { return prisma.user.create({ data: { email: `${label}-${slot}@example.invalid`, username: `${label}-${slot}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() } }); }
async function planet(ownerId: string, name: string) { return prisma.planet.create({ data: { ownerId, name, galaxy: 1, system: 300, slot: slot++, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: new Date() } }); }
async function frigateMission(origin: { id: string; ownerId: string }, target: { id: string; ownerId: string }, phase: FrigateStrikePhase = 'OUTBOUND') {
  return prisma.fleetMission.create({ data: { originId: origin.id, targetId: target.id, targetGalaxy: 1, targetSystem: 300, targetSlot: 2, missionType: 'ATTACK', ships: { legacy: 'unchanged' }, cargo: { legacy: 'unchanged' }, speedPercent: 100, departedAt: new Date('2026-12-01T00:00:00.000Z'), arrivesAt: new Date('2026-12-01T00:01:00.000Z'), returnsAt: new Date('2026-12-01T00:02:00.000Z'), status: phase, frigateStrikeOriginPlanetId: origin.id, frigateStrikeTargetPlanetId: target.id, frigateStrikeAttackerId: origin.ownerId, frigateStrikeDefenderId: target.ownerId, frigateStrikeShips: { frigate: 2 }, frigateStrikeOutboundFuelHeliox: 21, frigateStrikeReturnFuelHeliox: 21, frigateStrikeOutboundDurationSeconds: 60, frigateStrikeReturnDurationSeconds: 60, frigateStrikeResolverVersion: 'frigate-strike-v1', frigateStrikeResolverSeed: 'a'.repeat(64), frigateStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, frigateStrikePhase: phase } });
}

describe('canonical Frigate strike persistence', () => {
  beforeEach(() => { slot = 1; });
  it('records the migration and keeps historical generic and Corvette rows Frigate-null', async () => {
    expect(await prisma.$queryRaw<Array<{ migration_name: string }>>`SELECT "migration_name" FROM "_prisma_migrations" WHERE "migration_name"='20260916000000_add_frigate_strike_snapshots'`).toEqual([{ migration_name: '20260916000000_add_frigate_strike_snapshots' }]);
    const owner = await user('legacy'); const origin = await planet(owner.id, 'Origin'); const target = await planet(owner.id, 'Target');
    const legacy = await prisma.fleetMission.create({ data: { originId: origin.id, targetId: target.id, targetGalaxy: 1, targetSystem: 300, targetSlot: target.slot, missionType: 'ATTACK', ships: { corvette: 2 }, cargo: { legacy: true }, speedPercent: 37, arrivesAt: new Date(), status: 'RETURNING', jobId: 'legacy-job', resultSummary: { old: true } } });
    expect(legacy).toMatchObject({ ships: { corvette: 2 }, cargo: { legacy: true }, speedPercent: 37, jobId: 'legacy-job', frigateStrikeOriginPlanetId: null, frigateStrikeTargetPlanetId: null, frigateStrikeAttackerId: null, frigateStrikeDefenderId: null, frigateStrikeShips: null, frigateStrikePhase: null });
  });
  it('enforces only the named active Frigate invariant and permits terminal Frigate plus historical Corvette rows', async () => {
    const attacker = await user('attacker'); const defender = await user('defender'); const origin = await planet(attacker.id, 'Origin'); const first = await planet(defender.id, 'First'); const second = await planet(defender.id, 'Second');
    await frigateMission(origin, first);
    await expect(frigateMission(origin, second, 'RETURNING')).rejects.toMatchObject({ code: 'P2002' } as Partial<Prisma.PrismaClientKnownRequestError>);
    await expect(frigateMission(origin, second, 'COMPLETE')).resolves.toMatchObject({ frigateStrikePhase: 'COMPLETE' });
    const corvette = await prisma.fleetMission.create({ data: { originId: origin.id, targetId: first.id, targetGalaxy: 1, targetSystem: 300, targetSlot: first.slot, missionType: 'ATTACK', ships: { corvette: 1 }, cargo: {}, arrivesAt: new Date(), status: 'OUTBOUND', corvetteStrikeOriginPlanetId: origin.id, corvetteStrikeTargetPlanetId: first.id, corvetteStrikeAttackerId: attacker.id, corvetteStrikeDefenderId: defender.id, corvetteStrikeShips: { corvette: 1 }, corvetteStrikeOutboundFuelHeliox: 1, corvetteStrikeReturnFuelHeliox: 1, corvetteStrikeOutboundDurationSeconds: 60, corvetteStrikeReturnDurationSeconds: 60, corvetteStrikeResolverVersion: 'corvette-strike-v2', corvetteStrikeResolverSeed: 'b'.repeat(64), corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, corvetteStrikePhase: 'OUTBOUND' } });
    expect(corvette.frigateStrikePhase).toBeNull();
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE tablename IN ('FleetMission','FrigateStrikeReport') AND indexname IN ('FleetMission_one_active_canonical_frigate_strike_per_origin','FleetMission_frigateStrikePhase_arrivesAt_idx','FleetMission_frigateStrikePhase_returnsAt_idx','FrigateStrikeReport_missionId_key')`;
    expect(indexes.map((row) => row.indexname).sort()).toEqual(['FleetMission_frigateStrikePhase_arrivesAt_idx','FleetMission_frigateStrikePhase_returnsAt_idx','FleetMission_one_active_canonical_frigate_strike_per_origin','FrigateStrikeReport_missionId_key']);
  });
});
