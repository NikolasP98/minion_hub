import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listUsers: vi.fn(), from: vi.fn() }));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({ auth: { admin: { listUsers: mocks.listUsers } }, from: mocks.from }),
}));

import {
  DEV_QA_ELIGIBLE_CAP,
  listDevQaLoginUsers,
  normalizeEligibleQaEmail,
} from './dev-qa-login.service';

function selectedTable(rows: unknown[]) {
  return { select: () => ({ in: async () => ({ data: rows, error: null }) }) };
}

describe('dev QA login eligibility', () => {
  it.each([
    [' Person@QA.MINION.TEST ', 'person@qa.minion.test'],
    ['ui-audit-owner@minion.test', 'ui-audit-owner@minion.test'],
    ['ui-audit-restricted@minion.test', 'ui-audit-restricted@minion.test'],
    ['person@qa.minion.test.evil', null],
    ['person@@qa.minion.test', null],
    ['@qa.minion.test', null],
    ['other@minion.test', null],
  ])('normalizes %s to %s', (email, expected) => {
    expect(normalizeEligibleQaEmail(email)).toBe(expected);
  });
});

describe('listDevQaLoginUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return selectedTable([{ id: 'qa-201', display_name: 'QA Two Hundred One' }]);
      }
      if (table === 'member_roles') {
        return selectedTable([{ org_id: 'org-1', profile_id: 'qa-201', role_key: 'viewer' }]);
      }
      if (table === 'organization_members') return selectedTable([]);
      if (table === 'organizations') {
        return selectedTable([{ id: 'org-1', name: 'QA Organization' }]);
      }
      throw new Error(`unexpected table ${table}`);
    });
  });

  it('scans beyond one auth page, filters before selecting, and returns only safe fields', async () => {
    mocks.listUsers
      .mockResolvedValueOnce({
        data: {
          users: Array.from({ length: 200 }, (_, index) => ({
            id: `ordinary-${index}`,
            email: `ordinary-${index}@example.test`,
          })),
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          users: [{ id: 'qa-201', email: 'profile@qa.minion.test', user_metadata: { x: 1 } }],
        },
        error: null,
      });

    const result = await listDevQaLoginUsers();
    expect(mocks.listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 200 });
    expect(result).toEqual({
      truncated: false,
      users: [
        {
          id: 'qa-201',
          email: 'profile@qa.minion.test',
          displayName: 'QA Two Hundred One',
          orgs: [{ orgName: 'QA Organization', roleKey: 'viewer' }],
        },
      ],
    });
  });

  it('caps eligible results and reports truncation', async () => {
    const eligible = Array.from({ length: DEV_QA_ELIGIBLE_CAP + 1 }, (_, index) => ({
      id: `qa-${index}`,
      email: `qa-${index}@qa.minion.test`,
    }));
    mocks.listUsers
      .mockResolvedValueOnce({ data: { users: eligible.slice(0, 200) }, error: null })
      .mockResolvedValueOnce({ data: { users: eligible.slice(200, 400) }, error: null })
      .mockResolvedValueOnce({ data: { users: eligible.slice(400) }, error: null });
    mocks.from.mockImplementation(() => selectedTable([]));

    const result = await listDevQaLoginUsers();
    expect(result.users).toHaveLength(DEV_QA_ELIGIBLE_CAP);
    expect(result.truncated).toBe(true);
  });
});
