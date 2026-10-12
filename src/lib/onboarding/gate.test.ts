import { describe, expect, it } from 'vitest';
import {
  nextOnboardingScope,
  pendingOnboardingScopes,
  requiresOnboarding,
  type OnboardingOrg,
} from './gate';

const owner = (onboardedAt: string | null): OnboardingOrg => ({ onboardedAt, role: 'owner' });
const member = (onboardedAt: string | null): OnboardingOrg => ({ onboardedAt, role: 'member' });
const DONE = '2026-10-12T00:00:00.000Z';

describe('first-run onboarding gate', () => {
  it('runs the org flow before the user flow when both are pending', () => {
    expect(pendingOnboardingScopes({ userOnboardedAt: null, activeOrg: owner(null) })).toEqual([
      'org',
      'user',
    ]);
    expect(nextOnboardingScope({ userOnboardedAt: null, activeOrg: owner(null) })).toBe('org');
  });

  it('runs only the user flow when the org is already set up', () => {
    expect(nextOnboardingScope({ userOnboardedAt: null, activeOrg: owner(DONE) })).toBe('user');
  });

  it('runs only the org flow for a returning user in a fresh org', () => {
    expect(nextOnboardingScope({ userOnboardedAt: DONE, activeOrg: owner(null) })).toBe('org');
  });

  it('never holds a plain member at the org flow they cannot submit', () => {
    expect(pendingOnboardingScopes({ userOnboardedAt: DONE, activeOrg: member(null) })).toEqual([]);
    expect(requiresOnboarding({ userOnboardedAt: DONE, activeOrg: member(null) })).toBe(false);
    // …but their own user flow still runs.
    expect(nextOnboardingScope({ userOnboardedAt: null, activeOrg: member(null) })).toBe('user');
  });

  it('lets a fully set-up user through', () => {
    expect(requiresOnboarding({ userOnboardedAt: DONE, activeOrg: owner(DONE) })).toBe(false);
    expect(nextOnboardingScope({ userOnboardedAt: DONE, activeOrg: owner(DONE) })).toBeNull();
  });

  it('ignores the org flow when there is no active org (the /join case)', () => {
    expect(pendingOnboardingScopes({ userOnboardedAt: DONE, activeOrg: null })).toEqual([]);
    expect(pendingOnboardingScopes({ userOnboardedAt: null, activeOrg: null })).toEqual(['user']);
  });

  it('treats an admin like an owner', () => {
    expect(
      nextOnboardingScope({
        userOnboardedAt: DONE,
        activeOrg: { onboardedAt: null, role: 'admin' },
      }),
    ).toBe('org');
  });
});
