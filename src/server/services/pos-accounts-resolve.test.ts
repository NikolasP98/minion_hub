import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `resolveClientAccount` — the fallback behind `/pos/accounts?client=…` (§32.2).
 *
 * `listClientAccounts` lists MOVEMENTS, so the till's deep link for a client who
 * has none found no row and opened an anonymous, empty drawer. The key must
 * resolve off the party spine / CRM contact instead — and a key naming nothing
 * in this org must resolve to NOTHING, so a forged id cannot probe the table.
 */
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));
vi.mock('./pos.service', () => ({
  PosError: class PosError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  getPosSettings: async () => ({}),
}));

let rows: unknown[] = [];
const tx = {
  select: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ['from', 'where']) chain[k] = () => chain;
    chain.limit = () => Promise.resolve(rows);
    return chain;
  },
};

import { resolveClientAccount } from './pos-accounts.service';

const ctx = { db: {} as never, tenantId: 'org-1' };

beforeEach(() => {
  rows = [];
});

describe('resolveClientAccount', () => {
  it('resolves a party key to a named, zeroed account', async () => {
    rows = [{ id: 'party-1', name: 'Ana Quispe' }];
    expect(await resolveClientAccount(ctx, 'party:party-1')).toEqual({
      clientKey: 'party:party-1',
      partyId: 'party-1',
      crmContactId: null,
      displayName: 'Ana Quispe',
      balance: 0,
      activeGrants: 0,
      openPlans: 0,
      openPlanTotal: 0,
      pendingScheduling: 0,
      pendingTicketId: null,
    });
  });

  it('resolves a contact key and carries its party spine along', async () => {
    rows = [{ id: 'contact-1', name: 'Ana Q.', partyId: 'party-1' }];
    expect(await resolveClientAccount(ctx, 'contact:contact-1')).toMatchObject({
      // The REQUESTED key is echoed — the page matches the URL on it.
      clientKey: 'contact:contact-1',
      crmContactId: 'contact-1',
      partyId: 'party-1',
    });
  });

  it('answers null for a key that names nothing in this org', async () => {
    rows = [];
    expect(await resolveClientAccount(ctx, 'party:someone-elses')).toBeNull();
  });

  it('rejects a malformed key rather than guessing a column', async () => {
    await expect(resolveClientAccount(ctx, 'party')).rejects.toMatchObject({
      code: 'invalid_client_key',
    });
  });
});
