import { evaluateCombatTargetEligibility } from './combatTargetEligibility';

const now = new Date('2026-09-17T12:00:00.000Z');
const attacker = { id: 'attacker', status: 'ACTIVE', emailVerifiedAt: now };
const origin = { ownerId: 'attacker', galaxy: 1, system: 10, slot: 1 };
const requestedTarget = { galaxy: 1, system: 11, slot: 2 };
const target = {
  id: 'target-planet', ownerId: 'defender', galaxy: 1, system: 11, slot: 2,
  owner: { id: 'defender', status: 'ACTIVE', emailVerifiedAt: now, protectedUntil: null },
};

describe('canonical combat target eligibility', () => {
  it('allows only an active, verified, unprotected other-player target in the attacker galaxy', () => {
    expect(evaluateCombatTargetEligibility({ attacker, origin, requestedTarget, target, now })).toEqual({ eligible: true, code: 'ELIGIBLE' });
  });

  it.each([
    ['missing', null, requestedTarget, 'TARGET_UNAVAILABLE'],
    ['self-owned', { ...target, ownerId: 'attacker', owner: { ...target.owner, id: 'attacker' } }, requestedTarget, 'TARGET_UNAVAILABLE'],
    ['unverified', { ...target, owner: { ...target.owner, emailVerifiedAt: null } }, requestedTarget, 'TARGET_UNAVAILABLE'],
    ['inactive', { ...target, owner: { ...target.owner, status: 'SUSPENDED' } }, requestedTarget, 'TARGET_UNAVAILABLE'],
    ['protected', { ...target, owner: { ...target.owner, protectedUntil: new Date(now.getTime() + 1) } }, requestedTarget, 'TARGET_PROTECTED'],
    ['cross-galaxy', target, { ...requestedTarget, galaxy: 2 }, 'INVALID_TARGET'],
    ['origin coordinate', target, origin, 'INVALID_TARGET'],
  ] as const)('rejects %s without exposing account state', (_label, candidate, coordinates, code) => {
    expect(evaluateCombatTargetEligibility({ attacker, origin, requestedTarget: coordinates, target: candidate, now })).toEqual({ eligible: false, code });
  });

  it('rejects an origin that is not owned by the authenticated attacker', () => {
    expect(evaluateCombatTargetEligibility({ attacker, origin: { ...origin, ownerId: 'other' }, requestedTarget, target, now }))
      .toEqual({ eligible: false, code: 'TARGET_UNAVAILABLE' });
  });
});
