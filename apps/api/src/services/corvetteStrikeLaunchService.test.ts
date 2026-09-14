import { AccountStatus } from '@prisma/client';
import { CORVETTE_STRIKE_RESOLVER_VERSION, planCorvetteStrike } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { launchCanonicalCorvetteStrike, CorvetteStrikeLaunchInput } from './corvetteStrikeLaunchService';

let number = 1;
async function player(label: string, options: { status?: AccountStatus; verified?: boolean; protected?: boolean } = {}) {
  return prisma.user.create({ data: { email: `${label}-${number}@example.invalid`, username: `${label}-${number}`, passwordHash: 'not-used', status: options.status ?? 'ACTIVE', emailVerifiedAt: options.verified === false ? null : new Date(), protectedUntil: options.protected ? new Date(Date.now() + 60_000) : null } });
}
async function planet(ownerId: string, system: number, slot: number, heliox = 9000) { return prisma.planet.create({ data: { ownerId, name: `World ${system}:${slot}`, galaxy: 1, system, slot, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 1000, heliox, aether: 1000, lastProductionAt: new Date() } }); }
async function fixture(options: { corvettes?: number; heliox?: number; protected?: boolean } = {}) {
  number += 1; const attacker = await player('strike-a'); const defender = await player('strike-d', { protected: options.protected }); const origin = await planet(attacker.id, 20 + number, 1, options.heliox); const target = await planet(defender.id, 21 + number, 2); if ((options.corvettes ?? 3) >= 0) await prisma.ship.create({ data: { planetId: origin.id, key: 'corvette', count: options.corvettes ?? 3 } }); return { attacker, defender, origin, target };
}
function input(data: Awaited<ReturnType<typeof fixture>>, overrides: Partial<CorvetteStrikeLaunchInput> = {}): CorvetteStrikeLaunchInput { return { userId: data.attacker.id, originPlanetId: data.origin.id, target: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot }, quantity: 2, ...overrides }; }
async function expectError(promise: Promise<unknown>, code: string) { await expect(promise).rejects.toMatchObject({ name: 'CorvetteStrikeLaunchError', code }); }

describe('launchCanonicalCorvetteStrike', () => {
  beforeEach(() => { number = 1; });
  it('atomically reserves server-planned Corvettes and round-trip Heliox without target effects', async () => {
    const data = await fixture(); const expected = planCorvetteStrike({ origin: { galaxy: data.origin.galaxy, system: data.origin.system, slot: data.origin.slot }, target: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot }, quantity: 2, fleetSpeed: 1 });
    const result = await launchCanonicalCorvetteStrike(input(data)); const [mission, ships, origin, target] = await Promise.all([prisma.fleetMission.findUniqueOrThrow({ where: { id: result.missionId } }), prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } }), prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }), prisma.planet.findUniqueOrThrow({ where: { id: data.target.id } })]);
    expect(result).toMatchObject({ ships: { corvette: 2 }, phase: 'OUTBOUND', outboundFuelHeliox: expected.outboundFuelHeliox, returnFuelHeliox: expected.returnFuelHeliox });
    expect(mission).toMatchObject({ missionType: 'ATTACK', status: 'OUTBOUND', corvetteStrikeOriginPlanetId: data.origin.id, corvetteStrikeTargetPlanetId: data.target.id, corvetteStrikeAttackerId: data.attacker.id, corvetteStrikeDefenderId: data.defender.id, corvetteStrikeShips: { corvette: 2 }, corvetteStrikePhase: 'OUTBOUND', corvetteStrikeResolverVersion: CORVETTE_STRIKE_RESOLVER_VERSION, jobId: null, resultSummary: null });
    expect(mission.corvetteStrikeResolverSeed).toMatch(/^[a-f0-9]{64}$/); expect(ships.count).toBe(1); expect(origin.heliox).toBe(9000 - expected.outboundFuelHeliox - expected.returnFuelHeliox); expect(target).toMatchObject({ alloy: 1000, heliox: 9000, aether: 1000 }); expect(await prisma.corvetteStrikeReport.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  });
  it('rejects protected, unavailable, self and cross-galaxy targets without reservations', async () => {
    const protectedTarget = await fixture({ protected: true }); await expectError(launchCanonicalCorvetteStrike(input(protectedTarget)), 'TARGET_PROTECTED');
    const self = await fixture(); await expectError(launchCanonicalCorvetteStrike(input(self, { target: { galaxy: 1, system: self.origin.system, slot: self.origin.slot } })), 'TARGET_UNAVAILABLE');
    const cross = await fixture(); await expectError(launchCanonicalCorvetteStrike(input(cross, { target: { galaxy: 2, system: cross.target.system, slot: cross.target.slot } })), 'TARGET_UNAVAILABLE');
    const invalid = await fixture(); await expectError(launchCanonicalCorvetteStrike(input(invalid, { target: { galaxy: 0, system: invalid.target.system, slot: invalid.target.slot } })), 'INVALID_TARGET');
    expect(await prisma.fleetMission.count()).toBe(0); expect((await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: protectedTarget.origin.id, key: 'corvette' } } })).count).toBe(3);
  });
  it('rejects insufficient resources or Corvettes with no mission side effect', async () => {
    const noShips = await fixture({ corvettes: 1 }); await expectError(launchCanonicalCorvetteStrike(input(noShips)), 'INSUFFICIENT_CORVETTES'); const noFuel = await fixture({ heliox: 0 }); await expectError(launchCanonicalCorvetteStrike(input(noFuel)), 'INSUFFICIENT_HELIOX'); expect(await prisma.fleetMission.count()).toBe(0);
  });
  it('accepts no client-controlled target ids, timing, seed, report, speed, or cargo fields', async () => {
    const data = await fixture(); await expectError(launchCanonicalCorvetteStrike({ ...input(data), targetId: data.target.id } as unknown as CorvetteStrikeLaunchInput), 'INVALID_TARGET'); expect(await prisma.fleetMission.count()).toBe(0);
  });
  it('concurrent launches reserve at most one mission and never oversend Corvettes', async () => {
    const data = await fixture(); const results = await Promise.allSettled([launchCanonicalCorvetteStrike(input(data)), launchCanonicalCorvetteStrike(input(data))]); expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter((result) => result.status === 'rejected').map((result) => (result as PromiseRejectedResult).reason.code)).toEqual(['STRIKE_IN_PROGRESS']); expect(await prisma.fleetMission.count()).toBe(1); expect((await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } })).count).toBe(1);
  });
});
