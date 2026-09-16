/**
 * The sole eligibility policy for destructive canonical strikes. Callers must
 * supply records read from PostgreSQL; browser values are only coordinates to
 * compare against those records. This deliberately has no timing side effects
 * and never returns an owner identity or protection timestamp.
 */
export type CombatEligibilityCode = 'ELIGIBLE' | 'INVALID_TARGET' | 'TARGET_UNAVAILABLE' | 'TARGET_PROTECTED';

export type CombatCoordinates = { galaxy: number; system: number; slot: number };
export type CombatEligibilityOrigin = CombatCoordinates & { ownerId: string };
export type CombatEligibilityAccount = { id: string; status: string; emailVerifiedAt: Date | null };
export type CombatEligibilityPlanet = CombatCoordinates & {
  id: string;
  ownerId: string;
  owner: CombatEligibilityAccount & { protectedUntil: Date | null };
};

export function isCombatPublicAccount(account: Pick<CombatEligibilityAccount, 'status' | 'emailVerifiedAt'>): boolean {
  return account.status === 'ACTIVE' && account.emailVerifiedAt !== null;
}

export function evaluateCombatTargetEligibility(input: {
  attacker: CombatEligibilityAccount | null;
  origin: CombatEligibilityOrigin | null;
  requestedTarget: CombatCoordinates;
  target: CombatEligibilityPlanet | null;
  now: Date;
}): { eligible: boolean; code: CombatEligibilityCode } {
  const { attacker, origin, requestedTarget, target, now } = input;
  if (!attacker || !isCombatPublicAccount(attacker) || !origin || origin.ownerId !== attacker.id) return { eligible: false, code: 'TARGET_UNAVAILABLE' };
  if (origin.galaxy !== requestedTarget.galaxy || (origin.system === requestedTarget.system && origin.slot === requestedTarget.slot)) {
    return { eligible: false, code: 'INVALID_TARGET' };
  }
  if (!target
    || target.galaxy !== requestedTarget.galaxy
    || target.system !== requestedTarget.system
    || target.slot !== requestedTarget.slot
    || target.ownerId === attacker.id
    || target.owner.id !== target.ownerId
    || !isCombatPublicAccount(target.owner)) {
    return { eligible: false, code: 'TARGET_UNAVAILABLE' };
  }
  if (target.owner.protectedUntil !== null && target.owner.protectedUntil > now) {
    return { eligible: false, code: 'TARGET_PROTECTED' };
  }
  return { eligible: true, code: 'ELIGIBLE' };
}
