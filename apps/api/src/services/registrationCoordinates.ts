import { GALAXY_COORDINATE_BOUNDS } from '@eonrover/shared';

export interface HomeworldCoordinate {
  galaxy: number;
  system: number;
  slot: number;
}

export function generateHomeworldCoordinate(): HomeworldCoordinate {
  return {
    galaxy: GALAXY_COORDINATE_BOUNDS.galaxy.min + Math.floor(Math.random()
      * (GALAXY_COORDINATE_BOUNDS.galaxy.max - GALAXY_COORDINATE_BOUNDS.galaxy.min + 1)),
    system: GALAXY_COORDINATE_BOUNDS.system.min + Math.floor(Math.random()
      * (GALAXY_COORDINATE_BOUNDS.system.max - GALAXY_COORDINATE_BOUNDS.system.min + 1)),
    slot: GALAXY_COORDINATE_BOUNDS.slot.min + Math.floor(Math.random()
      * (GALAXY_COORDINATE_BOUNDS.slot.max - GALAXY_COORDINATE_BOUNDS.slot.min + 1)),
  };
}
