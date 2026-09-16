import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `listClientAccounts` — one client key per person on `/pos/accounts`.
 *
 * D6 (2026-09-16 lifecycle QA): a party and its linked CRM contact used to
 * come back as TWO rows (`party:<id>` and `contact:<id>`) because the raw
 * per-source CTEs keyed on whichever id the movement itself recorded, with no
 * bridge back through `crm_contacts.party_id`. The fix joins that bridge into
 * every per-source key so a party-only movement folds into the SAME
 * `contact:` key its linked contact's own movements use — this is what these
 * tests fix in place: the query returns MOVEMENT ROWS keyed correctly, and
 * this test locks the row→ClientAccountSummary mapping contract that view
 * depends on (rounding, null handling), for both an already-merged
 * party+contact row and an unlinked party's own row.
 *
 * The merge SQL itself (the `link` CTE in listClientAccounts) needs a live
 * Postgres to verify end-to-end — no db is available in this worktree; see
 * proposals/2026-09-16-hub-pos-accounts-drawer-pending-scheduling.md for the
 * follow-up to add a `.sql.integration.test.ts` once one is.
 */
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));

let rows: Record<string, unknown>[] = [];
const tx = { execute: vi.fn(async () => rows) };

import { listClientAccounts } from './pos-accounts.service';

const ctx = { db: {} as never, tenantId: 'org-1' };

beforeEach(() => {
  rows = [];
  tx.execute.mockClear();
});

describe('listClientAccounts — row mapping', () => {
  it('a merged party+contact row reports ONE client key with the contact id and summed totals', async () => {
    // What the fixed SQL returns for a party whose movements span both a
    // party-only ledger row and a crm_contact-tagged grant: ONE row, keyed on
    // the contact (prefer the contact key), with grants/plans/pending summed
    // across both sources.
    rows = [
      {
        client_key: 'contact:c1',
        party_id: 'party-1',
        crm_contact_id: 'c1',
        balance: '120.5',
        active_grants: 5,
        open_plans: 1,
        plan_total: '300',
        pending_scheduling: 2,
        pending_ticket_id: 'ticket-9',
        display_name: 'QA DNI Verified',
      },
    ];

    const result = await listClientAccounts(ctx, {});

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      clientKey: 'contact:c1',
      partyId: 'party-1',
      crmContactId: 'c1',
      balance: 120.5,
      activeGrants: 5,
      openPlans: 1,
      openPlanTotal: 300,
      displayName: 'QA DNI Verified',
      pendingScheduling: 2,
      pendingTicketId: 'ticket-9',
    });
  });

  it('an unlinked party (no crm_contacts row) still reports its own party key', async () => {
    rows = [
      {
        client_key: 'party:p2',
        party_id: 'p2',
        crm_contact_id: null,
        balance: '0',
        active_grants: 1,
        open_plans: 0,
        plan_total: '0',
        pending_scheduling: 0,
        pending_ticket_id: null,
        display_name: 'Walk-in Ana',
      },
    ];

    const result = await listClientAccounts(ctx, {});

    expect(result).toHaveLength(1);
    expect(result[0].clientKey).toBe('party:p2');
    expect(result[0].crmContactId).toBeNull();
    expect(result[0].partyId).toBe('p2');
  });
});
