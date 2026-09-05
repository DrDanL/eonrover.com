import { PlanetType, Prisma } from '@prisma/client';
import { PLANET_TYPES, STARTING_RESOURCES } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { AppError, ERROR_CODES } from '../middleware/error';
import {
  EMAIL_VERIFICATION_TTL_MS,
  emailVerificationTokenStorageValue,
} from './emailVerificationService';
import { generateHomeworldCoordinate, HomeworldCoordinate } from './registrationCoordinates';

export const HOMEWORLD_ALLOCATION_ATTEMPTS = 10;
const STARTER_BUILDINGS = ['alloyMine', 'helioxExtractor', 'solarArray'] as const;

const PLANET_TYPE_KEYS = Object.keys(PLANET_TYPES) as Array<keyof typeof PLANET_TYPES>;
const PLANET_TYPE_TO_DB: Record<keyof typeof PLANET_TYPES, PlanetType> = {
  temperate: 'TEMPERATE',
  volcanic: 'VOLCANIC',
  ice: 'ICE',
  gasGiant: 'GAS_GIANT',
  barren: 'BARREN',
  oceanic: 'OCEANIC',
};

type RegistrationTransaction = Prisma.TransactionClient;

interface RegistrationOperations {
  createUser: (
    tx: RegistrationTransaction,
    data: Prisma.UserCreateArgs['data'],
  ) => Promise<{ id: string; email: string; username: string }>;
  createHomeworld: (
    tx: RegistrationTransaction,
    data: Prisma.PlanetCreateArgs['data'],
  ) => Promise<{ id: string }>;
  createVerificationToken: (
    tx: RegistrationTransaction,
    data: Prisma.VerificationTokenCreateArgs['data'],
  ) => Promise<{ id: string }>;
}

const DEFAULT_OPERATIONS: RegistrationOperations = {
  createUser: (tx, data) => tx.user.create({ data }),
  createHomeworld: (tx, data) => tx.planet.create({ data }),
  createVerificationToken: (tx, data) => tx.verificationToken.create({ data }),
};

export interface RegistrationProvisioningInput {
  email: string;
  username: string;
  passwordHash: string;
  verificationToken: string;
  protectionHours: number;
  now: Date;
}

export interface RegistrationProvisioningOptions {
  coordinateGenerator?: () => HomeworldCoordinate;
  maxCoordinateAttempts?: number;
  operations?: Partial<RegistrationOperations>;
}

export interface ProvisionedRegistration {
  user: {
    id: string;
    email: string;
    username: string;
  };
  homeworldId: string;
  verificationToken: string;
}

function randomInRange([min, max]: [number, number]): number {
  return Math.round(min + Math.random() * (max - min));
}

function uniqueConstraintTargets(error: unknown): string[] {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return [];
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.filter((value): value is string => typeof value === 'string');
  return typeof target === 'string' ? [target] : [];
}

function targetIncludes(targets: string[], field: string): boolean {
  return targets.some((target) => target === field || target.includes(field));
}

function isCoordinateConflict(error: unknown): boolean {
  const targets = uniqueConstraintTargets(error);
  return ['galaxy', 'system', 'slot'].every((field) => targetIncludes(targets, field));
}

function isIdentityConflict(error: unknown): boolean {
  const targets = uniqueConstraintTargets(error);
  return targetIncludes(targets, 'email') || targetIncludes(targets, 'username');
}

export async function provisionRegistration(
  input: RegistrationProvisioningInput,
  options: RegistrationProvisioningOptions = {},
): Promise<ProvisionedRegistration> {
  const maxAttempts = options.maxCoordinateAttempts ?? HOMEWORLD_ALLOCATION_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxCoordinateAttempts must be a positive integer');
  }

  const coordinateGenerator = options.coordinateGenerator ?? generateHomeworldCoordinate;
  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  const planetTypeKey = PLANET_TYPE_KEYS[Math.floor(Math.random() * PLANET_TYPE_KEYS.length)];
  const planetProfile = PLANET_TYPES[planetTypeKey];
  const protectedUntil = new Date(input.now.getTime() + input.protectionHours * 60 * 60 * 1_000);
  const verificationExpiresAt = new Date(input.now.getTime() + EMAIL_VERIFICATION_TTL_MS);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const coordinate = coordinateGenerator();

    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findFirst({
          where: {
            OR: [
              { email: { equals: input.email, mode: 'insensitive' } },
              { username: input.username },
            ],
          },
          select: { id: true },
        });
        if (existing) {
          throw new AppError(409, ERROR_CODES.CONFLICT, 'Email or username already in use');
        }

        const user = await operations.createUser(tx, {
          email: input.email,
          username: input.username,
          passwordHash: input.passwordHash,
          protectedUntil,
        });
        const homeworld = await operations.createHomeworld(tx, {
          owner: { connect: { id: user.id } },
          name: `${input.username}'s Homeworld`,
          isHomeworld: true,
          ...coordinate,
          planetType: PLANET_TYPE_TO_DB[planetTypeKey],
          temperature: randomInRange(planetProfile.temperatureRange),
          solarIndex:
            planetProfile.solarIndexRange[0] +
            Math.random() * (planetProfile.solarIndexRange[1] - planetProfile.solarIndexRange[0]),
          alloy: STARTING_RESOURCES.alloy,
          heliox: STARTING_RESOURCES.heliox,
          aether: STARTING_RESOURCES.aether,
          lastProductionAt: input.now,
          buildings: {
            create: STARTER_BUILDINGS.map((key) => ({ key, level: key === 'solarArray' ? 1 : 0 })),
          },
        });
        await operations.createVerificationToken(tx, {
          user: { connect: { id: user.id } },
          token: emailVerificationTokenStorageValue(input.verificationToken),
          type: 'EMAIL_VERIFY',
          createdAt: input.now,
          expiresAt: verificationExpiresAt,
        });

        return {
          user: { id: user.id, email: user.email, username: user.username },
          homeworldId: homeworld.id,
          verificationToken: input.verificationToken,
        };
      });
    } catch (error) {
      if (isCoordinateConflict(error)) {
        if (attempt + 1 < maxAttempts) continue;
        throw new AppError(
          503,
          ERROR_CODES.SERVICE_UNAVAILABLE,
          'Registration is temporarily unavailable. Please try again later.',
        );
      }
      if (error instanceof AppError) throw error;
      if (isIdentityConflict(error)) {
        throw new AppError(409, ERROR_CODES.CONFLICT, 'Email or username already in use');
      }
      throw error;
    }
  }

  throw new AppError(
    503,
    ERROR_CODES.SERVICE_UNAVAILABLE,
    'Registration is temporarily unavailable. Please try again later.',
  );
}
