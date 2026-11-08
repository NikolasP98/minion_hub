import { describe, expect, it, vi } from 'vitest';
import { buildCapabilities } from './rbac.service';
import { runWithEffectiveAuthority } from '$server/auth/effective-authority';
const db = vi.hoisted(() => ({ touched: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ tenantId: 'org', profileId: 'actor' }),
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async () => {
    db.touched();
    throw new Error('denied workflows must not reach database');
  },
}));
import { POST } from '../../routes/api/workflow/apply/+server';
import { transitionsFor, availableTransitions } from './workflow.service';
const scope = (invalid: boolean) => ({
  orgId: 'org',
  profileId: 'actor',
  roleKey: 'custom-denied',
  generation: 'generation',
  rank: 0,
  invalid,
  capabilities: buildCapabilities(invalid ? [] : ['custom-denied'], []),
});
describe('workflow simulation admission', () => {
  it.each([true, false])(
    'blocks unroled real workflow mutations when selected edit is absent (invalid=%s)',
    async (invalid) => {
      const request = new Request('https://fixture.invalid/api/workflow/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          docType: 'sales_order',
          docId: '00000000-0000-4000-8000-000000000001',
          action: 'Approve',
        }),
      });
      await expect(
        runWithEffectiveAuthority(scope(invalid), () =>
          POST({ locals: { user: { supabaseId: 'actor', role: 'user' } }, request } as never),
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        runWithEffectiveAuthority(scope(invalid), () =>
          transitionsFor({ tenantId: 'org' } as never, 'sales_order', 'doc', {
            id: 'actor',
            role: 'user',
            name: 'Actual actor',
          }),
        ),
      ).resolves.toEqual([]);
      expect(db.touched).not.toHaveBeenCalled();
    },
  );
  it('matches simulated admin as a role without restoring platform-admin self-approval or owner bypass', () => {
    const transitions = [
      { from: 'draft', to: 'done', action: 'Owner approval', role: 'owner' },
      {
        from: 'draft',
        to: 'done',
        action: 'Admin approval',
        role: 'admin',
        allowSelfApprove: false,
      },
    ];
    expect(
      availableTransitions(
        transitions,
        'draft',
        { id: 'actor', role: 'admin', adminBypass: false },
        'actor',
      ),
    ).toEqual([]);
    expect(
      availableTransitions(transitions, 'draft', { id: 'actor', role: 'admin' }, 'actor'),
    ).toHaveLength(2);
  });
});
