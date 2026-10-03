import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));
vi.mock('./pos/settings', () => ({ getPosSettingsInTx: vi.fn() }));

let rows: Record<string, unknown>[] = [];
const tx = { execute: vi.fn(async (_statement: SQL) => rows) };

import { getClientAccountDetail } from './pos-accounts.service';

const ctx = { db: {} as never, tenantId: 'org-1' };

function detailRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    present: true,
    canonical_kind: 'party',
    canonical_id: 'party-1',
    party_id: 'party-1',
    contact_id: null,
    identity_status: 'active',
    display_name: 'Ana',
    pos_currency: 'PEN',
    today: '2026-10-03',
    balances: [
      { currency: 'PEN', balance: '100.25' },
      { currency: 'USD', balance: '4.50' },
    ],
    ledger: [],
    ledger_has_more: false,
    plans: [],
    plans_has_more: false,
    grants: [],
    grants_has_more: false,
    ...patch,
  };
}

beforeEach(() => {
  rows = [];
  tx.execute.mockClear();
});

describe('getClientAccountDetail — one bounded authority snapshot', () => {
  it('returns canonical currency buckets after exactly two locks and one data statement', async () => {
    rows = [detailRow()];
    expect(await getClientAccountDetail(ctx, 'contact:contact-1')).toEqual({
      requestedClientKey: 'contact:contact-1',
      clientKey: 'party:party-1',
      client: { partyId: 'party-1', crmContactId: null },
      identityStatus: 'active',
      displayName: 'Ana',
      balancesByCurrency: [
        { currency: 'PEN', balance: 100.25 },
        { currency: 'USD', balance: 4.5 },
      ],
      balance: 100.25,
      balanceCurrency: 'PEN',
      ledger: [],
      ledgerHasMore: false,
      grants: [],
      grantsHasMore: false,
      plans: [],
      plansHasMore: false,
    });
    expect(tx.execute).toHaveBeenCalledTimes(3);
    const statements = tx.execute.mock.calls.map(
      (call) => new PgDialect().sqlToQuery(call[0] as SQL).sql,
    );
    expect(statements[0]).toContain('pos_advisory_key_v1($1, $2, $3, $4)');
    expect(statements[1]).toContain('pos_advisory_key_v1($1, $2, $3, $4)');
    expect(statements[2]).toContain('limit 201');
    expect(statements[2]).toContain('limit 101');
    expect(statements[2]).toContain('from identity i cross join policy');
  });

  it('keeps an owned orphan visible but reveals no foreign name', async () => {
    rows = [
      detailRow({
        canonical_kind: 'contact',
        canonical_id: 'missing-contact',
        party_id: null,
        contact_id: 'missing-contact',
        identity_status: 'missing_contact',
        display_name: null,
      }),
    ];
    expect(await getClientAccountDetail(ctx, 'contact:missing-contact')).toMatchObject({
      clientKey: 'contact:missing-contact',
      identityStatus: 'missing_contact',
      displayName: null,
    });
  });

  it('does not turn a foreign or random key into an empty account', async () => {
    rows = [detailRow({ present: false, identity_status: null })];
    expect(await getClientAccountDetail(ctx, 'party:foreign-party')).toBeNull();
  });

  it('rejects a grant whose immutable source ticket has disappeared', async () => {
    rows = [
      detailRow({
        grants: [
          {
            grant: {
              id: 'grant-1',
              orgId: 'org-1',
              partyId: 'party-1',
              crmContactId: null,
              sourceTicketId: 'ticket-1',
              sourceLineId: 'line-1',
              packageProductId: 'package-1',
              serviceProductId: 'service-1',
              sessionsTotal: 3,
              unitValue: '10',
              expiresAt: null,
              status: 'active',
              createdAt: '2026-10-03T00:00:00.000Z',
              cancelledAt: null,
              cancelledBy: null,
            },
            sourceCurrency: null,
            packageName: 'Package',
            sessionsUsed: 0,
          },
        ],
      }),
    ];
    await expect(getClientAccountDetail(ctx, 'party:party-1')).rejects.toMatchObject({
      code: 'invalid_stored_amount',
    });
  });
});
