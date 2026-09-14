import { prisma } from '../lib/prisma';
import { CORVETTE_STRIKE_RESOLVER_VERSION, CORVETTE_STRIKE_V1_RESOLVER_VERSION, settleCanonicalCorvetteStrike } from '@eonrover/shared';

let slot = 1;
async function user(label: string) { return prisma.user.create({ data: { email: `${label}@example.invalid`, username: label, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() } }); }
async function planet(ownerId: string, name: string) { return prisma.planet.create({ data: { ownerId, name, galaxy: 1, system: 90, slot: slot++, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: new Date() } }); }
async function fixture(options: { corvettes?: number; defenders?: number; defences?: number; phase?: 'OUTBOUND' | 'RETURNING'; due?: boolean; resolverVersion?: typeof CORVETTE_STRIKE_RESOLVER_VERSION | typeof CORVETTE_STRIKE_V1_RESOLVER_VERSION } = {}) {
  const attacker = await user(`strike-completion-a-${slot}`); const defender = await user(`strike-completion-d-${slot}`);
  const origin = await planet(attacker.id, 'Origin'); const target = await planet(defender.id, 'Target');
  await prisma.ship.create({ data: { planetId: target.id, key: 'corvette', count: options.defenders ?? 0 } });
  if ((options.defences ?? 0) > 0) await prisma.defence.create({ data: { planetId: target.id, key: 'flakTurret', count: options.defences ?? 0 } });
  const now = new Date('2026-12-02T00:10:00.000Z'); const arrivesAt = options.due === false ? new Date(now.getTime() + 60_000) : new Date(now.getTime() - 60_000); const departedAt = new Date(arrivesAt.getTime() - 60_000); const returnsAt = new Date(now.getTime() + 60_000);
  const mission = await prisma.fleetMission.create({ data: { originId: origin.id, targetId: target.id, targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot, missionType: 'ATTACK', ships: { compatibility: true }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100, departedAt, arrivesAt, returnsAt, status: options.phase ?? 'OUTBOUND', corvetteStrikeOriginPlanetId: origin.id, corvetteStrikeTargetPlanetId: target.id, corvetteStrikeAttackerId: attacker.id, corvetteStrikeDefenderId: defender.id, corvetteStrikeShips: { corvette: options.corvettes ?? 2 }, corvetteStrikeOutboundFuelHeliox: 1, corvetteStrikeReturnFuelHeliox: 1, corvetteStrikeOutboundDurationSeconds: 60, corvetteStrikeReturnDurationSeconds: 60, corvetteStrikeResolverVersion: options.resolverVersion ?? CORVETTE_STRIKE_V1_RESOLVER_VERSION, corvetteStrikeResolverSeed: 'b'.repeat(64), corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, corvetteStrikePhase: options.phase ?? 'OUTBOUND' } });
  return { attacker, defender, origin, target, mission, now };
}
beforeEach(() => { slot = 1; });
describe('canonical Corvette strike completion', () => {
  it('leaves an early outbound mission untouched', async () => {
    const data = await fixture({ due: false });
    expect(await settleCanonicalCorvetteStrike(prisma, data.mission.id, data.now)).toBe('early');
    expect(await prisma.corvetteStrikeReport.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
    expect((await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } })).corvetteStrikePhase).toBe('OUTBOUND');
  });
  it('resolves a due strike once, writes an immutable report and holds survivors for return', async () => {
    const data = await fixture({ corvettes: 3, defenders: 0 });
    expect(await settleCanonicalCorvetteStrike(prisma, data.mission.id, data.now)).toBe('arrived');
    const mission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } });
    expect(mission).toMatchObject({ corvetteStrikePhase: 'RETURNING', status: 'RETURNING' });
    const report = await prisma.corvetteStrikeReport.findUniqueOrThrow({ where: { missionId: data.mission.id } });
    expect(report).toMatchObject({ resolverVersion: CORVETTE_STRIKE_V1_RESOLVER_VERSION });
    expect(report.resultSnapshot).toMatchObject({
      target: {
        coordinates: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot },
        planet: { name: data.target.name, type: data.target.planetType },
      },
    });
    expect(await prisma.notification.count()).toBe(2);
    await expect(prisma.corvetteStrikeReport.update({ where: { missionId: data.mission.id }, data: { resolverVersion: 'changed' } })).rejects.toThrow('CorvetteStrikeReport rows are immutable');
    expect(await settleCanonicalCorvetteStrike(prisma, data.mission.id, data.now)).toBe('early');
    expect(await prisma.corvetteStrikeReport.count()).toBe(1); expect(await prisma.notification.count()).toBe(2);
  });
  it('settles a v2 mission once and persists its v2 report without changing v1 compatibility', async () => {
    const data = await fixture({ corvettes: 1, defences: 1, resolverVersion: CORVETTE_STRIKE_RESOLVER_VERSION });
    expect(await settleCanonicalCorvetteStrike(prisma, data.mission.id, data.now)).toBe('arrived');
    const report = await prisma.corvetteStrikeReport.findUniqueOrThrow({ where: { missionId: data.mission.id } });
    expect(report.resolverVersion).toBe(CORVETTE_STRIKE_RESOLVER_VERSION);
    expect(report.resultSnapshot).toMatchObject({ outcome: 'attacker', resolution: 'elimination' });
    await Promise.all(Array.from({ length: 3 }, () => settleCanonicalCorvetteStrike(prisma, data.mission.id, data.now)));
    expect(await prisma.corvetteStrikeReport.count({ where: { missionId: data.mission.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: { in: [data.attacker.id, data.defender.id] } } })).toBe(2);
  });
  it('applies defender losses once and restores only surviving Corvettes when return is due', async () => {
    const data = await fixture({ corvettes: 5, defenders: 1 });
    await settleCanonicalCorvetteStrike(prisma, data.mission.id, data.now);
    const arrived = await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } });
    const dueReturn = new Date((arrived.returnsAt as Date).getTime() + 1);
    expect(await settleCanonicalCorvetteStrike(prisma, data.mission.id, dueReturn)).toBe('returned');
    const report = await prisma.corvetteStrikeReport.findUniqueOrThrow({ where: { missionId: data.mission.id } });
    const survivors = ((report.resultSnapshot as any).survivors.attacker.corvette ?? 0) as number;
    expect((await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } })).count).toBe(survivors);
    expect((await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } })).corvetteStrikePhase).toBe('COMPLETE');
    await settleCanonicalCorvetteStrike(prisma, data.mission.id, new Date(dueReturn.getTime() + 1));
    expect((await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } })).count).toBe(survivors);
  });
  it('handles a wiped attacker and malformed or legacy rows safely', async () => {
    const wiped = await fixture({ corvettes: 1, defences: 100 });
    await settleCanonicalCorvetteStrike(prisma, wiped.mission.id, wiped.now);
    expect((await prisma.fleetMission.findUniqueOrThrow({ where: { id: wiped.mission.id } })).corvetteStrikePhase).toBe('COMPLETE');
    expect(await prisma.ship.findUnique({ where: { planetId_key: { planetId: wiped.origin.id, key: 'corvette' } } })).toBeNull();
    const legacy = await prisma.fleetMission.create({ data: { originId: wiped.origin.id, targetId: wiped.target.id, targetGalaxy: 1, targetSystem: 90, targetSlot: wiped.target.slot, missionType: 'ATTACK', ships: { legacy: true }, cargo: {}, arrivesAt: wiped.now } });
    expect(await settleCanonicalCorvetteStrike(prisma, legacy.id, wiped.now)).toBe('noop');
  });
});
