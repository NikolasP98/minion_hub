import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));
vi.mock('./pos/settings', () => ({
  getPosSettingsInTx: vi.fn(),
}));

let rows: Record<string, unknown>[] = [];
const tx = { execute: vi.fn(async (_statement: SQL) => rows) };

import { resolveClientAccount } from './pos-accounts.service';

const ctx = { db: {} as never, tenantId: 'org-1' };

beforeEach(() => {
  rows = [];
  tx.execute.mockClear();
});

describe('resolveClientAccount — canonical identity snapshot', () => {
  it('resolves a party key to one named, currency-aware zero account', async () => {
    rows = [
      {
        canonical_kind: 'party',
        canonical_id: 'party-1',
        party_id: 'party-1',
        contact_id: null,
        display_name: 'Ana Quispe',
        pos_currency: 'PEN',
      },
    ];
    expect(await resolveClientAccount(ctx, 'party:party-1')).toEqual({
      requestedClientKey: 'party:party-1',
      clientKey: 'party:party-1',
      partyId: 'party-1',
      crmContactId: null,
      displayName: 'Ana Quispe',
      identityStatus: 'active',
      balancesByCurrency: [],
      openPlansByCurrency: [],
      balance: 0,
      balanceCurrency: 'PEN',
      activeGrants: 0,
      openPlans: 0,
      totalOpenPlans: 0,
      openPlanTotal: 0,
      pendingScheduling: 0,
      pendingTicketId: null,
    });
  });

  it('returns a canonical party while retaining the requested contact alias', async () => {
    rows = [
      {
        canonical_kind: 'party',
        canonical_id: 'party-1',
        party_id: 'party-1',
        contact_id: 'contact-1',
        display_name: 'Ana Q.',
        pos_currency: 'USD',
      },
    ];
    expect(await resolveClientAccount(ctx, 'contact:contact-1')).toMatchObject({
      requestedClientKey: 'contact:contact-1',
      clientKey: 'party:party-1',
      crmContactId: 'contact-1',
      partyId: 'party-1',
      balanceCurrency: 'USD',
    });
  });

  it('takes settings and identity locks before exactly one data statement', async () => {
    rows = [];
    await resolveClientAccount(ctx, 'contact:contact-1');
    expect(tx.execute).toHaveBeenCalledTimes(3);
    const statements = tx.execute.mock.calls.map(
      (call) => new PgDialect().sqlToQuery(call[0] as SQL).sql,
    );
    expect(statements[0]).toContain('pg_advisory_xact_lock_shared');
    expect(statements[1]).toContain('pg_advisory_xact_lock_shared');
    expect(statements[2]).toContain('with input as');
    expect(statements[2]).toContain('left join public.crm_contacts');
  });

  it('answers null for a key that names nothing in this organization', async () => {
    rows = [{ canonical_kind: null, canonical_id: null }];
    expect(await resolveClientAccount(ctx, 'party:someone-elses')).toBeNull();
  });

  it('rejects a malformed key rather than guessing a column', async () => {
    await expect(resolveClientAccount(ctx, 'party')).rejects.toMatchObject({
      code: 'invalid_client_key',
    });
    expect(tx.execute).not.toHaveBeenCalled();
  });
});
