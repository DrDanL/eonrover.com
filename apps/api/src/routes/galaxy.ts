import { AccountStatus, PlanetType } from '@prisma/client';
import { GALAXY_COORDINATE_BOUNDS } from '@eonrover/shared';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireReadOnlyAuth } from '../middleware/auth';
import { asyncHandler, ERROR_CODES, sendError } from '../middleware/error';

const router = Router();
router.use(requireReadOnlyAuth);

export type GalaxySlotReadModel =
  | { slot: number; occupancy: 'empty' }
  | { slot: number; occupancy: 'unavailable' }
  | {
    slot: number;
    occupancy: 'public';
    planet: { name: string; type: PlanetType };
    owner: { username: string; protected: boolean };
  };

export interface GalaxySystemReadModel {
  galaxy: number;
  system: number;
  slots: GalaxySlotReadModel[];
}

function parseCoordinate(value: string, bounds: { min: number; max: number }): number | null {
  // Route values must be canonical decimal positive integers. This rejects
  // fractions, exponent notation, whitespace, trailing text and coercion.
  if (!/^[1-9]\d*$/.test(value)) return null;
  const coordinate = Number(value);
  if (!Number.isSafeInteger(coordinate) || coordinate < bounds.min || coordinate > bounds.max) return null;
  return coordinate;
}

function isPublicOwner(owner: { status: AccountStatus; emailVerifiedAt: Date | null }): boolean {
  // The data model has no separate hidden/inactive visibility state. Every
  // non-active or unverified account therefore receives the same opaque slot.
  return owner.status === AccountStatus.ACTIVE && owner.emailVerifiedAt !== null;
}

router.get('/:galaxy/:system', asyncHandler(async (req, res) => {
  const galaxy = parseCoordinate(req.params.galaxy, GALAXY_COORDINATE_BOUNDS.galaxy);
  const system = parseCoordinate(req.params.system, GALAXY_COORDINATE_BOUNDS.system);
  if (galaxy === null || system === null) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Invalid coordinates');
    return;
  }
  const planets = await prisma.planet.findMany({
    where: { galaxy, system },
    select: {
      slot: true,
      name: true,
      planetType: true,
      owner: { select: { username: true, protectedUntil: true, status: true, emailVerifiedAt: true } },
    },
    orderBy: { slot: 'asc' },
  });
  const currentTime = new Date();
  const slots: GalaxySlotReadModel[] = Array.from({ length: GALAXY_COORDINATE_BOUNDS.slot.max }, (_, index) => {
    const slot = GALAXY_COORDINATE_BOUNDS.slot.min + index;
    const planet = planets.find((p) => p.slot === slot);
    if (!planet) return { slot, occupancy: 'empty' };
    if (!isPublicOwner(planet.owner)) return { slot, occupancy: 'unavailable' };
    return {
      slot,
      occupancy: 'public',
      planet: { name: planet.name, type: planet.planetType },
      owner: {
        username: planet.owner.username,
        protected: planet.owner.protectedUntil ? planet.owner.protectedUntil > currentTime : false,
      },
    };
  });
  const response: GalaxySystemReadModel = { galaxy, system, slots };
  res.json(response);
}));

export default router;
