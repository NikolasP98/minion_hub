import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreDb: vi.fn(),
  upsertNotification: vi.fn(),
  resolveByKeys: vi.fn(),
  rule: vi.fn(),
}));

vi.mock('$server/db/pg-client', () => ({ getCoreDb: mocks.getCoreDb }));
vi.mock('$server/services/inbox/inbox.service', () => ({
  upsertNotification: mocks.upsertNotification,
  resolveByKeys: mocks.resolveByKeys,
}));
vi.mock('$server/services/inbox/rules', () => ({
  INBOX_RULES: [{ key: 'test.rule', evaluate: mocks.rule }],
}));

import { evaluateInboxRules } from './evaluate';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function dbWithOrgRows(orgIds: string[]) {
  return { execute: vi.fn().mockResolvedValue(orgIds.map((org_id) => ({ org_id }))) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertNotification.mockResolvedValue('new-id');
  mocks.resolveByKeys.mockResolvedValue(0);
});

describe('evaluateInboxRules — per-org isolation', () => {
  it('one org throwing does not stop the next org from running', async () => {
    mocks.getCoreDb.mockReturnValue(dbWithOrgRows([ORG_A, ORG_B]));
    mocks.rule.mockImplementation(async (ctx: { tenantId: string }) => {
      if (ctx.tenantId === ORG_A) throw new Error('boom');
      return { upserts: [{ dedupeKey: 'k', scope: 'org', kind: 'test', title: 't' }], resolve: [] };
    });

    const results = await evaluateInboxRules(new Date('2026-10-10T12:00:00Z'));

    expect(results).toHaveLength(2);
    const a = results.find((r) => r.orgId === ORG_A)!;
    const b = results.find((r) => r.orgId === ORG_B)!;
    // Org A's rule threw, but evaluateOrg swallows a per-rule failure and still
    // reports ok (the isolation boundary is the rule, caught inside the loop).
    expect(a.ok).toBe(true);
    expect(a.upserted).toBe(0);
    expect(b.ok).toBe(true);
    expect(b.upserted).toBe(1);
    expect(mocks.upsertNotification).toHaveBeenCalledTimes(1);
  });

  it('resolves dedupe keys the rule reports as cleared', async () => {
    mocks.getCoreDb.mockReturnValue(dbWithOrgRows([ORG_A]));
    mocks.rule.mockResolvedValue({ upserts: [], resolve: ['stale-key'] });
    mocks.resolveByKeys.mockResolvedValue(1);

    const [result] = await evaluateInboxRules(new Date());

    expect(mocks.resolveByKeys).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ORG_A }), [
      'stale-key',
    ]);
    expect(result.resolved).toBe(1);
  });
});
