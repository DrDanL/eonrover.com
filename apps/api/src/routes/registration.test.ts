import { PlanetType } from '@prisma/client';
import { DEFAULT_PLANET_FIELD_CAPACITY, PLANET_TYPES, STARTING_RESOURCES } from '@eonrover/shared';
import request from 'supertest';
import { createApp } from '../app';
import { verifyPassword } from '../lib/auth';
import { sendMail } from '../lib/mailer';
import { prisma } from '../lib/prisma';
import { ERROR_CODES } from '../middleware/error';
import { invalidateUniverseConfigCache, setUniverseConfigValue } from '../services/gameConfig';
import * as registrationCoordinates from '../services/registrationCoordinates';
import {
  HOMEWORLD_ALLOCATION_ATTEMPTS,
  provisionRegistration,
  RegistrationProvisioningInput,
} from '../services/registrationService';

jest.mock('../lib/mailer', () => ({
  ...jest.requireActual('../lib/mailer'),
  sendMail: jest.fn(),
}));

const app = createApp();
const mockedSendMail = sendMail as jest.MockedFunction<typeof sendMail>;
const csrfHeader = { 'X-Eonrover-Client': '1' };

const PLANET_TYPE_TO_PROFILE: Record<PlanetType, keyof typeof PLANET_TYPES> = {
  TEMPERATE: 'temperate',
  VOLCANIC: 'volcanic',
  ICE: 'ice',
  GAS_GIANT: 'gasGiant',
  BARREN: 'barren',
  OCEANIC: 'oceanic',
};

function register(email: string, username: string, password = 'Password123') {
  return request(app)
    .post('/api/auth/register')
    .set(csrfHeader)
    .send({ email, username, password });
}

function provisioningInput(
  overrides: Partial<RegistrationProvisioningInput> = {},
): RegistrationProvisioningInput {
  return {
    email: 'rollback@example.com',
    username: 'rollback1',
    passwordHash: 'already-hashed-password',
    verificationToken: 'verification-token-for-test',
    protectionHours: 72,
    now: new Date('2026-01-02T03:04:05.000Z'),
    ...overrides,
  };
}

async function occupyCoordinate(coordinate: registrationCoordinates.HomeworldCoordinate): Promise<void> {
  const owner = await prisma.user.create({
    data: {
      email: `owner-${coordinate.galaxy}-${coordinate.system}-${coordinate.slot}@example.com`,
      username: `owner_${coordinate.galaxy}_${coordinate.system}_${coordinate.slot}`,
      passwordHash: 'not-used',
    },
  });
  await prisma.planet.create({
    data: {
      ownerId: owner.id,
      name: 'Occupied planet',
      isHomeworld: true,
      ...coordinate,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
    },
  });
}

async function reserveCanonicalColonizationTarget(coordinate: registrationCoordinates.HomeworldCoordinate): Promise<void> {
  const owner = await prisma.user.create({
    data: {
      email: `colonizer-${coordinate.galaxy}-${coordinate.system}-${coordinate.slot}@example.com`,
      username: `colonizer_${coordinate.galaxy}_${coordinate.system}_${coordinate.slot}`,
      passwordHash: 'not-used',
      status: 'ACTIVE',
    },
  });
  const origin = await prisma.planet.create({
    data: {
      ownerId: owner.id,
      name: 'Colonizer origin',
      galaxy: coordinate.galaxy,
      system: coordinate.system,
      slot: coordinate.slot === 1 ? 2 : 1,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
    },
  });
  await prisma.fleetMission.create({
    data: {
      originId: origin.id,
      targetGalaxy: coordinate.galaxy,
      targetSystem: coordinate.system,
      targetSlot: coordinate.slot,
      missionType: 'COLONIZE',
      ships: { colonyShip: 1 },
      cargo: { alloy: 0, heliox: 0, aether: 0 },
      arrivesAt: new Date('2026-12-01T00:00:00.000Z'),
      colonizationAccountId: owner.id,
      colonizationTargetGalaxy: coordinate.galaxy,
      colonizationTargetSystem: coordinate.system,
      colonizationTargetSlot: coordinate.slot,
      colonizationShips: { colonyShip: 1 },
      colonizationFuelHeliox: 10,
      colonizationDurationSeconds: 60,
      colonizationCharacteristics: { planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, fieldCapacity: 180 },
      colonizationStarterState: { resources: { alloy: 500, heliox: 300, aether: 0 }, buildings: { solarArray: 1, alloyMine: 0, helioxExtractor: 0 } },
    },
  });
}

beforeEach(() => {
  mockedSendMail.mockReset();
  mockedSendMail.mockResolvedValue(undefined);
  invalidateUniverseConfigCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  invalidateUniverseConfigCache();
});

describe('atomic registration provisioning', () => {
  it('normalises input and creates exactly one account with its required server-defined state', async () => {
    const beforeRegistration = Date.now();
    await register('  PILOT@Example.COM  ', '  pilot_1  ', 'Password123').expect(201, {
      message: 'Registered. Check your email to verify your account.',
      requiresVerification: true,
      verificationEmailSent: true,
    });
    const afterRegistration = Date.now();

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.planet.count()).toBe(1);
    expect(await prisma.verificationToken.count()).toBe(1);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'pilot@example.com' },
      include: {
        planets: { include: { buildings: true } },
        verificationTokens: true,
      },
    });
    expect(user.username).toBe('pilot_1');
    expect(user.status).toBe('PENDING_VERIFICATION');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).not.toBe('Password123');
    await expect(verifyPassword('Password123', user.passwordHash)).resolves.toBe(true);
    expect(user.protectedUntil?.getTime()).toBeGreaterThanOrEqual(beforeRegistration + 72 * 60 * 60 * 1_000);
    expect(user.protectedUntil?.getTime()).toBeLessThanOrEqual(afterRegistration + 72 * 60 * 60 * 1_000);

    expect(user.planets).toHaveLength(1);
    const planet = user.planets[0];
    expect(planet).toMatchObject({
      name: "pilot_1's Homeworld",
      isHomeworld: true,
      alloy: STARTING_RESOURCES.alloy,
      heliox: STARTING_RESOURCES.heliox,
      aether: STARTING_RESOURCES.aether,
      fieldCapacity: DEFAULT_PLANET_FIELD_CAPACITY,
    });
    expect(planet.galaxy).toBeGreaterThanOrEqual(1);
    expect(planet.galaxy).toBeLessThanOrEqual(6);
    expect(planet.system).toBeGreaterThanOrEqual(1);
    expect(planet.system).toBeLessThanOrEqual(400);
    expect(planet.slot).toBeGreaterThanOrEqual(1);
    expect(planet.slot).toBeLessThanOrEqual(12);
    expect(planet.lastProductionAt.getTime()).toBeGreaterThanOrEqual(beforeRegistration);
    expect(planet.lastProductionAt.getTime()).toBeLessThanOrEqual(afterRegistration);

    const planetProfile = PLANET_TYPES[PLANET_TYPE_TO_PROFILE[planet.planetType]];
    expect(planet.temperature).toBeGreaterThanOrEqual(planetProfile.temperatureRange[0]);
    expect(planet.temperature).toBeLessThanOrEqual(planetProfile.temperatureRange[1]);
    expect(planet.solarIndex).toBeGreaterThanOrEqual(planetProfile.solarIndexRange[0]);
    expect(planet.solarIndex).toBeLessThanOrEqual(planetProfile.solarIndexRange[1]);
    expect(
      planet.buildings
        .map(({ key, level }) => ({ key, level }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    ).toEqual([
      { key: 'alloyMine', level: 0 },
      { key: 'helioxExtractor', level: 0 },
      { key: 'solarArray', level: 1 },
    ]);

    expect(user.verificationTokens).toHaveLength(1);
    expect(user.verificationTokens[0]).toMatchObject({ type: 'EMAIL_VERIFY', usedAt: null });
    expect(user.verificationTokens[0].expiresAt.getTime()).toBeGreaterThanOrEqual(
      beforeRegistration + 24 * 60 * 60 * 1_000,
    );
    expect(user.verificationTokens[0].expiresAt.getTime()).toBeLessThanOrEqual(
      afterRegistration + 24 * 60 * 60 * 1_000,
    );
  });

  it('uses the current configured new-player protection duration', async () => {
    await setUniverseConfigValue('newPlayerProtectionHours', 6);
    const beforeRegistration = Date.now();

    await register('protected@example.com', 'protected1').expect(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'protected@example.com' } });
    const expectedProtectionEnd = beforeRegistration + 6 * 60 * 60 * 1_000;
    expect(user.protectedUntil?.getTime()).toBeGreaterThanOrEqual(expectedProtectionEnd);
    expect(user.protectedUntil?.getTime()).toBeLessThanOrEqual(expectedProtectionEnd + 5_000);
  });

  it('rolls back the user when homeworld provisioning fails', async () => {
    await expect(
      provisionRegistration(provisioningInput(), {
        operations: {
          createHomeworld: async () => {
            throw new Error('forced homeworld failure');
          },
        },
      }),
    ).rejects.toThrow('forced homeworld failure');

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.planet.count()).toBe(0);
    expect(await prisma.verificationToken.count()).toBe(0);
  });

  it('rolls back the user and homeworld when verification-record creation fails', async () => {
    await expect(
      provisionRegistration(provisioningInput(), {
        operations: {
          createVerificationToken: async () => {
            throw new Error('forced verification failure');
          },
        },
      }),
    ).rejects.toThrow('forced verification failure');

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.planet.count()).toBe(0);
    expect(await prisma.verificationToken.count()).toBe(0);
  });

  it('restarts the complete transaction with a new coordinate after a collision', async () => {
    const occupied = { galaxy: 1, system: 1, slot: 1 };
    const available = { galaxy: 1, system: 1, slot: 2 };
    await occupyCoordinate(occupied);
    const coordinateSpy = jest
      .spyOn(registrationCoordinates, 'generateHomeworldCoordinate')
      .mockReturnValueOnce(occupied)
      .mockReturnValueOnce(available);

    await register('collision@example.com', 'collision1').expect(201);

    expect(coordinateSpy).toHaveBeenCalledTimes(2);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'collision@example.com' } });
    expect(await prisma.planet.count({ where: { ownerId: user.id } })).toBe(1);
    expect(
      await prisma.planet.findUnique({ where: { galaxy_system_slot: available } }),
    ).toMatchObject({ ownerId: user.id, isHomeworld: true });
    expect(await prisma.verificationToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it('skips an active canonical colonisation reservation during homeworld allocation', async () => {
    const reserved = { galaxy: 3, system: 9, slot: 4 };
    const available = { galaxy: 3, system: 9, slot: 5 };
    await reserveCanonicalColonizationTarget(reserved);
    const coordinateSpy = jest
      .spyOn(registrationCoordinates, 'generateHomeworldCoordinate')
      .mockReturnValueOnce(reserved)
      .mockReturnValueOnce(available);

    await register('reserved-slot@example.com', 'reserved_slot').expect(201);

    expect(coordinateSpy).toHaveBeenCalledTimes(2);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'reserved-slot@example.com' } });
    expect(await prisma.planet.findUnique({ where: { galaxy_system_slot: available } })).toMatchObject({ ownerId: user.id });
    expect(await prisma.planet.findUnique({ where: { galaxy_system_slot: reserved } })).toBeNull();
  });

  it('serializes concurrent coordinate claims and allocates one valid alternative rather than colliding', async () => {
    const contested = { galaxy: 4, system: 10, slot: 6 };
    const firstAlternative = { galaxy: 4, system: 10, slot: 7 };
    const secondAlternative = { galaxy: 4, system: 10, slot: 8 };
    let firstCalls = 0;
    let secondCalls = 0;
    const firstGenerator = () => (firstCalls++ === 0 ? contested : firstAlternative);
    const secondGenerator = () => (secondCalls++ === 0 ? contested : secondAlternative);

    const [first, second] = await Promise.all([
      provisionRegistration(provisioningInput({
        email: 'coordinate-race-one@example.com',
        username: 'coordinate_race_one',
        verificationToken: 'coordinate-race-one-token',
      }), { coordinateGenerator: firstGenerator }),
      provisionRegistration(provisioningInput({
        email: 'coordinate-race-two@example.com',
        username: 'coordinate_race_two',
        verificationToken: 'coordinate-race-two-token',
      }), { coordinateGenerator: secondGenerator }),
    ]);

    expect(new Set([first.homeworldId, second.homeworldId]).size).toBe(2);
    const claimed = await prisma.planet.findMany({
      where: { ownerId: { in: [first.user.id, second.user.id] } },
      select: { galaxy: true, system: true, slot: true },
    });
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map(({ galaxy, system, slot }) => `${galaxy}:${system}:${slot}`)).size).toBe(2);
    expect(claimed).toEqual(expect.arrayContaining([expect.objectContaining(contested)]));
    expect(claimed.some((coordinate) => (
      (coordinate.galaxy === firstAlternative.galaxy
        && coordinate.system === firstAlternative.system
        && coordinate.slot === firstAlternative.slot)
      || (coordinate.galaxy === secondAlternative.galaxy
        && coordinate.system === secondAlternative.system
        && coordinate.slot === secondAlternative.slot)
    ))).toBe(true);
  });

  it('returns a safe temporary error and no partial account when coordinate retries are exhausted', async () => {
    const occupied = { galaxy: 2, system: 3, slot: 4 };
    await occupyCoordinate(occupied);
    const coordinateSpy = jest
      .spyOn(registrationCoordinates, 'generateHomeworldCoordinate')
      .mockReturnValue(occupied);

    const response = await register(
      'exhausted@example.com',
      'exhausted1',
      'PasswordWithSecretMarker123',
    ).expect(503, {
      error: 'Registration is temporarily unavailable. Please try again later.',
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });

    expect(coordinateSpy).toHaveBeenCalledTimes(HOMEWORLD_ALLOCATION_ATTEMPTS);
    expect(await prisma.user.count({ where: { email: 'exhausted@example.com' } })).toBe(0);
    expect(await prisma.verificationToken.count()).toBe(0);
    expect(await prisma.planet.count()).toBe(1);
    expect(response.text).not.toMatch(/PasswordWithSecretMarker123|verification|P2002|Prisma|galaxy_system_slot/i);
  });

  it('allows only one of two concurrent registrations with the same credentials', async () => {
    const responses = await Promise.all([
      register('race@example.com', 'race_pilot'),
      register('race@example.com', 'race_pilot'),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'race@example.com' } });
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.planet.count({ where: { ownerId: user.id } })).toBe(1);
    expect(await prisma.verificationToken.count({ where: { userId: user.id } })).toBe(1);
    const conflict = responses.find(({ status }) => status === 409);
    expect(conflict?.body).toEqual({
      error: 'Email or username already in use',
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('returns 409 for a normalised duplicate email without provisioning another planet', async () => {
    await register('duplicate@example.com', 'first_pilot').expect(201);
    await register('  DUPLICATE@EXAMPLE.COM ', 'second_pilot').expect(409, {
      error: 'Email or username already in use',
      code: ERROR_CODES.CONFLICT,
    });

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.planet.count()).toBe(1);
    expect(await prisma.verificationToken.count()).toBe(1);
  });

  it('returns 409 for a trimmed duplicate username without provisioning another planet', async () => {
    await register('first@example.com', 'shared_pilot').expect(201);
    await register('second@example.com', '  shared_pilot  ').expect(409, {
      error: 'Email or username already in use',
      code: ERROR_CODES.CONFLICT,
    });

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.planet.count()).toBe(1);
    expect(await prisma.verificationToken.count()).toBe(1);
  });

  it('does not begin email dispatch until the registration transaction has committed', async () => {
    mockedSendMail.mockImplementationOnce(async (to) => {
      const user = await prisma.user.findUnique({
        where: { email: to },
        include: { planets: true, verificationTokens: true },
      });
      expect(user).not.toBeNull();
      expect(user?.planets).toHaveLength(1);
      expect(user?.verificationTokens).toHaveLength(1);
    });

    await register('mail-order@example.com', 'mail_order').expect(201);

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
  });

  it('keeps the committed account and returns a recovery response when SMTP fails', async () => {
    mockedSendMail.mockRejectedValueOnce(
      new Error('smtp.internal.example rejected verification-token-secret and P2002 metadata'),
    );

    const response = await register('smtp-failure@example.com', 'smtp_failure').expect(201, {
      message:
        'Your account was created, but the verification email could not be sent. Please request another verification email.',
      requiresVerification: true,
      verificationEmailSent: false,
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'smtp-failure@example.com' } });
    expect(await prisma.planet.count({ where: { ownerId: user.id } })).toBe(1);
    expect(await prisma.verificationToken.count({ where: { userId: user.id } })).toBe(1);
    expect(response.text).not.toMatch(/smtp\.internal|verification-token-secret|P2002|Prisma|constraint/i);
  });
});
