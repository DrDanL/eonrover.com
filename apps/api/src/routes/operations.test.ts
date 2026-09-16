import request from 'supertest';
import { MissionStatus, MissionType } from '@prisma/client';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';

const app = createApp();
let fixture = 0;
let coordinate = 1;

beforeEach(() => { fixture += 1; coordinate = 1; });

async function player(label: string) {
  const id = `${label}-${fixture}`;
  const user = await prisma.user.create({ data: { email: `${id}@example.invalid`, username: id, passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const token = `operations-${user.id}`;
  await prisma.session.create({ data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function planet(ownerId: string, name: string) {
  const position = coordinate++;
  return prisma.planet.create({ data: {
    ownerId, name, galaxy: 1, system: fixture * 100 + position, slot: position <= 12 ? position : ((position - 1) % 12) + 1,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 10_000, heliox: 10_000, aether: 10_000, lastProductionAt: new Date(),
  } });
}

function times(secondsFromNow: number) {
  const departedAt = new Date(Date.now() - 60_000);
  const arrivesAt = new Date(Date.now() + secondsFromNow * 1_000);
  return { departedAt, arrivesAt, returnsAt: new Date(arrivesAt.getTime() + 60_000) };
}

async function canonicalFixture() {
  const owner = await player('operations-owner');
  const opponent = await player('operations-opponent');
  const deployOrigin = await planet(owner.user.id, 'Deploy Origin');
  const deployTarget = await planet(owner.user.id, 'Deploy Target');
  const colonyOrigin = await planet(owner.user.id, 'Colony Origin');
  const transportOrigin = await planet(owner.user.id, 'Transport Origin');
  const transportTarget = await planet(owner.user.id, 'Transport Target');
  const probeOrigin = await planet(owner.user.id, 'Probe Origin');
  const probeTarget = await planet(opponent.user.id, 'Probe Target');
  const corvetteOrigin = await planet(owner.user.id, 'Corvette Origin');
  const corvetteTarget = await planet(opponent.user.id, 'Corvette Target');
  const frigateOrigin = await planet(owner.user.id, 'Frigate Origin');
  const frigateTarget = await planet(opponent.user.id, 'Frigate Target');
  return { owner, opponent, deployOrigin, deployTarget, colonyOrigin, transportOrigin, transportTarget, probeOrigin, probeTarget, corvetteOrigin, corvetteTarget, frigateOrigin, frigateTarget };
}

async function createOperations(data: Awaited<ReturnType<typeof canonicalFixture>>) {
  const deploy = times(600);
  await prisma.fleetMission.create({ data: {
    originId: data.deployOrigin.id, targetId: data.deployTarget.id, targetGalaxy: data.deployTarget.galaxy, targetSystem: data.deployTarget.system, targetSlot: data.deployTarget.slot,
    missionType: MissionType.DEPLOY, ships: { scout: 1 }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100, departedAt: deploy.departedAt, arrivesAt: deploy.arrivesAt, status: MissionStatus.OUTBOUND,
    deployOriginId: data.deployOrigin.id, deployDestinationId: data.deployTarget.id, deployShips: { scout: 1 }, deployFuelHeliox: 1, deployDurationSeconds: 660,
  } });
  const colony = times(500);
  await prisma.fleetMission.create({ data: {
    originId: data.colonyOrigin.id, targetGalaxy: data.colonyOrigin.galaxy, targetSystem: data.colonyOrigin.system, targetSlot: 12,
    missionType: MissionType.COLONIZE, ships: { colonyShip: 1 }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100, departedAt: colony.departedAt, arrivesAt: colony.arrivesAt, status: MissionStatus.OUTBOUND,
    colonizationAccountId: data.owner.user.id, colonizationTargetGalaxy: data.colonyOrigin.galaxy, colonizationTargetSystem: data.colonyOrigin.system, colonizationTargetSlot: 12,
    colonizationShips: { colonyShip: 1 }, colonizationFuelHeliox: 1, colonizationDurationSeconds: 560, colonizationCharacteristics: { planetType: 'TEMPERATE' }, colonizationStarterState: { fieldCapacity: 180 },
  } });
  const transport = times(400);
  await prisma.fleetMission.create({ data: {
    originId: data.transportOrigin.id, targetId: data.transportTarget.id, targetGalaxy: data.transportTarget.galaxy, targetSystem: data.transportTarget.system, targetSlot: data.transportTarget.slot,
    missionType: MissionType.TRANSPORT, ships: { transporter: 2 }, cargo: { alloy: 2, heliox: 3, aether: 4 }, speedPercent: 100, departedAt: transport.departedAt, arrivesAt: transport.arrivesAt, returnsAt: transport.returnsAt, status: MissionStatus.RETURNING,
    transportOriginId: data.transportOrigin.id, transportDestinationId: data.transportTarget.id, transportShips: { transporter: 2 }, transportCargo: { alloy: 2, heliox: 3, aether: 4 }, transportRemainingCargo: { alloy: 0, heliox: 0, aether: 0 }, transportCapacity: 100, transportOutboundFuelHeliox: 1, transportReturnFuelHeliox: 1, transportTotalReservedFuelHeliox: 2, transportOutboundDurationSeconds: 460, transportReturnDurationSeconds: 60, transportPhase: 'RETURNING',
  } });
  const probe = times(300);
  await prisma.fleetMission.create({ data: {
    originId: data.probeOrigin.id, targetId: data.probeTarget.id, targetGalaxy: data.probeTarget.galaxy, targetSystem: data.probeTarget.system, targetSlot: data.probeTarget.slot,
    missionType: MissionType.ESPIONAGE, ships: { probe: 1 }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100, departedAt: probe.departedAt, arrivesAt: probe.arrivesAt, returnsAt: probe.returnsAt, status: MissionStatus.OUTBOUND,
    espionageOriginPlanetId: data.probeOrigin.id, espionageTargetPlanetId: data.probeTarget.id, espionageOriginAccountId: data.owner.user.id, espionageTargetAccountId: data.opponent.user.id, espionageProbeShips: { probe: 1 }, espionageOutboundFuelHeliox: 1, espionageReturnFuelHeliox: 1, espionageOutboundDurationSeconds: 360, espionageReturnDurationSeconds: 60, espionageProbePhase: 'OUTBOUND',
  } });
  const corvette = times(200);
  await prisma.fleetMission.create({ data: {
    originId: data.corvetteOrigin.id, targetId: data.corvetteTarget.id, targetGalaxy: data.corvetteTarget.galaxy, targetSystem: data.corvetteTarget.system, targetSlot: data.corvetteTarget.slot,
    missionType: MissionType.ATTACK, ships: { corvette: 2 }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100, departedAt: corvette.departedAt, arrivesAt: corvette.arrivesAt, returnsAt: corvette.returnsAt, status: MissionStatus.OUTBOUND,
    corvetteStrikeOriginPlanetId: data.corvetteOrigin.id, corvetteStrikeTargetPlanetId: data.corvetteTarget.id, corvetteStrikeAttackerId: data.owner.user.id, corvetteStrikeDefenderId: data.opponent.user.id, corvetteStrikeShips: { corvette: 2 }, corvetteStrikeOutboundFuelHeliox: 1, corvetteStrikeReturnFuelHeliox: 1, corvetteStrikeOutboundDurationSeconds: 260, corvetteStrikeReturnDurationSeconds: 60, corvetteStrikePhase: 'OUTBOUND',
  } });
  const frigate = times(100);
  await prisma.fleetMission.create({ data: {
    originId: data.frigateOrigin.id, targetId: data.frigateTarget.id, targetGalaxy: data.frigateTarget.galaxy, targetSystem: data.frigateTarget.system, targetSlot: data.frigateTarget.slot,
    missionType: MissionType.ATTACK, ships: { frigate: 3 }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100, departedAt: frigate.departedAt, arrivesAt: frigate.arrivesAt, returnsAt: frigate.returnsAt, status: MissionStatus.OUTBOUND,
    frigateStrikeOriginPlanetId: data.frigateOrigin.id, frigateStrikeTargetPlanetId: data.frigateTarget.id, frigateStrikeAttackerId: data.owner.user.id, frigateStrikeDefenderId: data.opponent.user.id, frigateStrikeShips: { frigate: 3 }, frigateStrikeOutboundFuelHeliox: 1, frigateStrikeReturnFuelHeliox: 1, frigateStrikeOutboundDurationSeconds: 160, frigateStrikeReturnDurationSeconds: 60, frigateStrikePhase: 'OUTBOUND',
  } });
}

describe('Mission Control operations API', () => {
  it('requires authentication and returns a safe empty operations response', async () => {
    await request(app).get('/api/operations').expect(401);
    const account = await player('operations-empty');
    await request(app).get('/api/operations').set('Cookie', account.cookie).expect(200, { operations: [] });
  });

  it('merges all active canonical mission families without exposing internal mission or target identities', async () => {
    const data = await canonicalFixture();
    await createOperations(data);
    const response = await request(app).get('/api/operations').set('Cookie', data.owner.cookie).expect(200);
    expect(response.body.operations).toHaveLength(6);
    expect(response.body.operations.map((operation: { missionType: string }) => operation.missionType)).toEqual(['FRIGATE_STRIKE', 'CORVETTE_STRIKE', 'ESPIONAGE_PROBE', 'TRANSPORT', 'COLONIZATION', 'DEPLOY']);
    expect(response.body.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ missionType: 'DEPLOY', phase: 'OUTBOUND', manifest: { scout: 1 }, cargo: null, origin: { name: 'Deploy Origin', coordinates: expect.any(Object) } }),
      expect.objectContaining({ missionType: 'COLONIZATION', manifest: { colonyShip: 1 }, destination: { galaxy: data.colonyOrigin.galaxy, system: data.colonyOrigin.system, slot: 12 } }),
      expect.objectContaining({ missionType: 'TRANSPORT', phase: 'RETURNING', direction: 'RETURNING', manifest: { transporter: 2 }, cargo: { alloy: 0, heliox: 0, aether: 0 } }),
      expect.objectContaining({ missionType: 'ESPIONAGE_PROBE', manifest: { probe: 1 } }),
      expect.objectContaining({ missionType: 'CORVETTE_STRIKE', manifest: { corvette: 2 } }),
      expect.objectContaining({ missionType: 'FRIGATE_STRIKE', manifest: { frigate: 3 } }),
    ]));
    const serialized = JSON.stringify(response.body);
    for (const hidden of [data.owner.user.id, data.opponent.user.id, data.probeTarget.id, data.corvetteTarget.id, data.frigateTarget.id, 'jobId', 'resolverVersion', 'seed', 'ships', 'resultSummary']) expect(serialized).not.toContain(hidden);
  });

  it('excludes terminal, legacy, malformed, and other-account rows without mutations', async () => {
    const data = await canonicalFixture();
    await createOperations(data);
    const legacy = await prisma.fleetMission.create({ data: {
      originId: data.deployOrigin.id, targetGalaxy: 9, targetSystem: 9, targetSlot: 9, missionType: MissionType.TRANSPORT, ships: { scout: 99 }, cargo: { alloy: 999 }, arrivesAt: new Date(Date.now() + 99_000), status: MissionStatus.OUTBOUND,
    } });
    const terminal = await prisma.fleetMission.create({ data: {
      originId: data.deployOrigin.id, targetId: data.deployTarget.id, targetGalaxy: data.deployTarget.galaxy, targetSystem: data.deployTarget.system, targetSlot: data.deployTarget.slot, missionType: MissionType.DEPLOY, ships: { scout: 1 }, cargo: {}, arrivesAt: new Date(), status: MissionStatus.COMPLETE,
      deployOriginId: data.deployOrigin.id, deployDestinationId: data.deployTarget.id, deployShips: { scout: 1 }, deployFuelHeliox: 1, deployDurationSeconds: 1,
    } });
    const malformedOrigin = await planet(data.owner.user.id, 'Malformed Probe Origin');
    const malformedTarget = await planet(data.opponent.user.id, 'Malformed Probe Target');
    const malformed = await prisma.fleetMission.create({ data: {
      originId: malformedOrigin.id, targetId: malformedTarget.id, targetGalaxy: malformedTarget.galaxy, targetSystem: malformedTarget.system, targetSlot: malformedTarget.slot, missionType: MissionType.ESPIONAGE, ships: {}, cargo: {}, arrivesAt: new Date(Date.now() + 60_000), status: MissionStatus.OUTBOUND,
      espionageOriginPlanetId: malformedOrigin.id, espionageTargetPlanetId: malformedTarget.id, espionageOriginAccountId: data.owner.user.id, espionageTargetAccountId: data.opponent.user.id, espionageProbeShips: { probe: 2 }, espionageOutboundFuelHeliox: 1, espionageReturnFuelHeliox: 1, espionageOutboundDurationSeconds: 60, espionageReturnDurationSeconds: 60, espionageProbePhase: 'OUTBOUND',
    } });
    const before = await Promise.all([prisma.fleetMission.findUniqueOrThrow({ where: { id: legacy.id } }), prisma.fleetMission.findUniqueOrThrow({ where: { id: terminal.id } }), prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.id } }), prisma.notification.count()]);
    const response = await request(app).get('/api/operations').set('Cookie', data.owner.cookie).expect(200);
    expect(response.body.operations).toHaveLength(6);
    const after = await Promise.all([prisma.fleetMission.findUniqueOrThrow({ where: { id: legacy.id } }), prisma.fleetMission.findUniqueOrThrow({ where: { id: terminal.id } }), prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.id } }), prisma.notification.count()]);
    expect(after).toEqual(before);
  });

  it('returns a stably ordered bounded response', async () => {
    const account = await player('operations-bounded');
    for (let index = 0; index < 52; index += 1) {
      const origin = await planet(account.user.id, `Origin ${index}`);
      const target = await planet(account.user.id, `Target ${index}`);
      const departure = new Date(Date.now() - 60_000);
      const arrival = new Date(Date.now() + (index + 1) * 1_000);
      await prisma.fleetMission.create({ data: {
        originId: origin.id, targetId: target.id, targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot, missionType: MissionType.DEPLOY, ships: { scout: 1 }, cargo: {}, speedPercent: 100, departedAt: departure, arrivesAt: arrival, status: MissionStatus.OUTBOUND,
        deployOriginId: origin.id, deployDestinationId: target.id, deployShips: { scout: 1 }, deployFuelHeliox: 1, deployDurationSeconds: 61 + index,
      } });
    }
    const response = await request(app).get('/api/operations').set('Cookie', account.cookie).expect(200);
    expect(response.body.operations).toHaveLength(50);
    expect(response.body.operations[0].origin.name).toBe('Origin 0');
    expect(response.body.operations[49].origin.name).toBe('Origin 49');
  });
});
