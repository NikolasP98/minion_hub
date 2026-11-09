import { describe, expect, it } from 'vitest';
import { buildCapabilities } from '$server/services/rbac.service';
import {
  currentEffectiveAuthority,
  runWithEffectiveAuthority,
  rejectSimulatedDelegation,
  narrowAdmittedCapabilities,
  runWithRequestCapabilities,
  currentRequestCapabilities,
  isSimulating,
} from './effective-authority';

const scope = {
  profileId: 'actor-a',
  orgId: 'org-a',
  roleKey: 'viewer',
  rank: 10,
  generation: 'generation-a',
  invalid: false,
  capabilities: buildCapabilities(['viewer'], []),
};
describe('effective authority request isolation', () => {
  it('matches the exact actor and organization across awaits and never changes another member', async () => {
    await runWithEffectiveAuthority(scope, async () => {
      await Promise.resolve();
      expect(currentEffectiveAuthority('org-a', 'actor-a')?.capabilities.roles).toEqual(['viewer']);
      expect(currentEffectiveAuthority('org-b', 'actor-a')).toBeUndefined();
      expect(currentEffectiveAuthority('org-a', 'actor-b')).toBeUndefined();
    });
    expect(currentEffectiveAuthority('org-a', 'actor-a')).toBeUndefined();
  });
  it('keeps simultaneous requests separate and blocks new delegated work only in simulation', async () => {
    await Promise.all([
      runWithEffectiveAuthority(scope, async () => {
        await Promise.resolve();
        expect(() => rejectSimulatedDelegation()).toThrow();
      }),
      runWithEffectiveAuthority(undefined, async () => {
        await Promise.resolve();
        expect(() => rejectSimulatedDelegation()).not.toThrow();
      }),
    ]);
  });
  it('narrowing cannot turn an overview-only role or disjoint business modules into analytics authority', () => {
    const empty = buildCapabilities(['custom-empty'], []);
    expect(empty.canRunAnalytics()).toBe(false);
    expect(narrowAdmittedCapabilities(empty, empty).canRunAnalytics()).toBe(false);
    const row = (role_key: string, module: string) => ({
      role_key,
      module,
      can_view: true,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_export: false,
      can_manage: false,
    });
    expect(
      narrowAdmittedCapabilities(
        buildCapabilities(['a'], [row('a', 'crm')]),
        buildCapabilities(['b'], [row('b', 'finance')]),
      ).canRunAnalytics(),
    ).toBe(false);
  });

  it('fresh off-mode authority bypasses stale rows without becoming a simulation', async () => {
    const caps = buildCapabilities(['custom-empty'], []);
    await runWithRequestCapabilities(
      { orgId: 'org-a', profileId: 'actor-a', capabilities: caps },
      async () => {
        expect(currentRequestCapabilities('org-a', 'actor-a')).toBe(caps);
        expect(currentRequestCapabilities('org-b', 'actor-a')).toBeUndefined();
        expect(currentRequestCapabilities('org-a', 'actor-b')).toBeUndefined();
        expect(isSimulating()).toBe(false);
        expect(() => rejectSimulatedDelegation()).not.toThrow();
      },
    );
    expect(currentRequestCapabilities('org-a', 'actor-a')).toBeUndefined();
  });
});
