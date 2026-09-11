/**
 * Compatibility exports for existing API callers. The shared implementation
 * keeps registration and colonisation completion on the same advisory key.
 */
export {
  coordinateAdvisoryLockKey,
  lockCoordinateForTransaction,
} from '@eonrover/shared';
export type { CoordinateLockCoordinate } from '@eonrover/shared';
