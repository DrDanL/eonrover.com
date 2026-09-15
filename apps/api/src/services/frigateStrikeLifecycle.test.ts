import { prisma } from '../lib/prisma';
import { frigateStrikeArrivalQueue, fleetQueue } from '../lib/redis';
import { FRIGATE_STRIKE_RESOLVER_VERSION } from '@eonrover/shared';
import { launchCanonicalFrigateStrike, FrigateStrikeLaunchError } from './frigateStrikeLaunchService';
import { settleCanonicalFrigateStrike } from './frigateStrikeCompletionService';
import { frigateStrikeArrivalJobId, frigateStrikeReturnJobId } from './frigateStrikeArrivalSchedulingService';

let sequence = 0;
const jobIds = new Set<string>();
async function user(label: string, options: { protected?: boolean; active?: boolean } = {}) { return prisma.user.create({ data: { email: `${label}-${sequence}@example.invalid`, username: `${label}-${sequence}`, passwordHash: 'x', status: options.active === false ? 'SUSPENDED' : 'ACTIVE', emailVerifiedAt: new Date(), protectedUntil: options.protected ? new Date(Date.now() + 60_000) : null } }); }
async function planet(ownerId: string, system: number, slot: number, heliox = 12_000) { return prisma.planet.create({ data: { ownerId, name: `World ${system}:${slot}`, galaxy: 1, system, slot, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, heliox, lastProductionAt: new Date() } }); }
async function fixture(options: { frigates?: number; heliox?: number; protected?: boolean; defence?: 'flakTurret' | 'railBattery' | 'planetaryShield'; defenceCount?: number } = {}) {
  sequence += 1; const attacker = await user('frigate-a'); const defender = await user('frigate-d', { protected: options.protected }); const origin = await planet(attacker.id, 20 + sequence * 2, 1, options.heliox); const target = await planet(defender.id, 21 + sequence * 2, 2);
  await prisma.ship.create({ data: { planetId: origin.id, key: 'frigate', count: options.frigates ?? 3 } });
  if (options.defence) await prisma.defence.create({ data: { planetId: target.id, key: options.defence, count: options.defenceCount ?? 1 } });
  return { attacker, defender, origin, target };
}
function input(data: Awaited<ReturnType<typeof fixture>>, quantity = 2) { return { userId: data.attacker.id, originPlanetId: data.origin.id, target: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot }, quantity }; }
async function clearJobs() { for (const id of jobIds) await (await frigateStrikeArrivalQueue.getJob(id))?.remove(); jobIds.clear(); }
afterEach(async () => { await clearJobs(); jest.restoreAllMocks(); });

describe('canonical Frigate strike lifecycle', () => {
  it('launches from server state, reserves Frigates/fuel once, snapshots facts, and schedules after commit', async () => {
    const data = await fixture();
    const result = await launchCanonicalFrigateStrike(input(data)); const arrivalId = frigateStrikeArrivalJobId(result.missionId); jobIds.add(arrivalId);
    const [mission, ship, origin] = await Promise.all([prisma.fleetMission.findUniqueOrThrow({ where: { id: result.missionId } }), prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'frigate' } } }), prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })]);
    expect(mission).toMatchObject({ missionType: 'ATTACK', frigateStrikeOriginPlanetId: data.origin.id, frigateStrikeTargetPlanetId: data.target.id, frigateStrikeAttackerId: data.attacker.id, frigateStrikeDefenderId: data.defender.id, frigateStrikeShips: { frigate: 2 }, frigateStrikeResolverVersion: FRIGATE_STRIKE_RESOLVER_VERSION, frigateStrikePhase: 'OUTBOUND', status: 'OUTBOUND' });
    expect(mission.frigateStrikeResolverSeed).toMatch(/^[a-f0-9]{64}$/); expect(ship.count).toBe(1); expect(origin.heliox).toBe(10_000 - mission.frigateStrikeOutboundFuelHeliox! - mission.frigateStrikeReturnFuelHeliox!);
    expect(await frigateStrikeArrivalQueue.getJob(arrivalId)).toMatchObject({ name: 'complete-frigate-strike-arrival', data: { missionId: result.missionId } });
    expect(fleetQueue.name).toBe('fleet-queue');
  });
  it('rejects invalid target, protection, inventory, fuel and active origin without side effects', async () => {
    const protectedTarget = await fixture({ protected: true }); await expect(launchCanonicalFrigateStrike(input(protectedTarget))).rejects.toMatchObject({ code: 'TARGET_PROTECTED' } satisfies Partial<FrigateStrikeLaunchError>);
    const noShips = await fixture({ frigates: 1 }); await expect(launchCanonicalFrigateStrike(input(noShips))).rejects.toMatchObject({ code: 'INSUFFICIENT_FRIGATES' } satisfies Partial<FrigateStrikeLaunchError>);
    const noFuel = await fixture({ heliox: 0 }); await expect(launchCanonicalFrigateStrike(input(noFuel))).rejects.toMatchObject({ code: 'INSUFFICIENT_HELIOX' } satisfies Partial<FrigateStrikeLaunchError>);
    expect(await prisma.fleetMission.count()).toBe(0);
  });
  it('settles decisive forces once, persists arrival-time reports, returns only survivors, and leaves a shield as a stalemate', async () => {
    const decisive = await fixture({ defence: 'flakTurret', defenceCount: 1 }); const accepted = await launchCanonicalFrigateStrike(input(decisive)); jobIds.add(frigateStrikeArrivalJobId(accepted.missionId));
    const due = new Date((await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).arrivesAt.getTime() + 1);
    expect(await settleCanonicalFrigateStrike(accepted.missionId, due)).toBe('arrived'); const returnId = frigateStrikeReturnJobId(accepted.missionId); jobIds.add(returnId);
    await Promise.all([settleCanonicalFrigateStrike(accepted.missionId, due), settleCanonicalFrigateStrike(accepted.missionId, due)]);
    const report = await prisma.frigateStrikeReport.findUniqueOrThrow({ where: { missionId: accepted.missionId } }); const snapshot = report.resultSnapshot as any;
    expect(snapshot).toMatchObject({ resolution: 'elimination', starting: { defender: { flakTurret: 1 } } }); expect(await prisma.notification.count({ where: { userId: { in: [decisive.attacker.id, decisive.defender.id] } } })).toBe(2); expect(await prisma.frigateStrikeReport.count({ where: { missionId: accepted.missionId } })).toBe(1);
    await prisma.defence.upsert({ where: { planetId_key: { planetId: decisive.target.id, key: 'flakTurret' } }, update: { count: 99 }, create: { planetId: decisive.target.id, key: 'flakTurret', count: 99 } }); expect((await prisma.frigateStrikeReport.findUniqueOrThrow({ where: { missionId: accepted.missionId } }).then((value) => value.resultSnapshot as any)).starting.defender.flakTurret).toBe(1);
    const returnedAt = new Date((await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).returnsAt!.getTime() + 1); expect(await settleCanonicalFrigateStrike(accepted.missionId, returnedAt)).toBe('returned'); expect(await settleCanonicalFrigateStrike(accepted.missionId, returnedAt)).toBe('noop');
    expect((await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: decisive.origin.id, key: 'frigate' } } })).count).toBe(1 + (snapshot.survivors.attacker.frigate ?? 0));
    const shield = await fixture({ defence: 'planetaryShield' }); const shieldMission = await launchCanonicalFrigateStrike(input(shield)); jobIds.add(frigateStrikeArrivalJobId(shieldMission.missionId)); const shieldDue = new Date((await prisma.fleetMission.findUniqueOrThrow({ where: { id: shieldMission.missionId } })).arrivesAt.getTime() + 1); expect(await settleCanonicalFrigateStrike(shieldMission.missionId, shieldDue)).toBe('arrived'); expect((await prisma.frigateStrikeReport.findUniqueOrThrow({ where: { missionId: shieldMission.missionId } }).then((value) => value.resultSnapshot as any)).resolution).toBe('stalemate');
  });
});
