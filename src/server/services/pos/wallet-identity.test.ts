import { describe, expect, it } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  canonicalWalletClientKey,
  resolvePersistedWalletLockOwner,
  resolveWalletIdentity,
  walletOwnedPredicate,
} from './wallet-identity';
import { posClientLedger } from '$server/db/pg-pos-schema';
import { PgDialect } from 'drizzle-orm/pg-core';

const orgId = 'org-1';

describe('canonical wallet identity', () => {
  it('accepts a verified party without requiring a contact facet', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'party-1' }]]);
    expect(await resolveWalletIdentity(db as never, orgId, { partyId: 'party-1' })).toEqual({
      partyId: 'party-1',
      crmContactId: null,
      clientKey: 'party:party-1',
      identityStatus: 'active',
    });
  });

  it('canonicalizes an active linked contact to its verified party', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'contact-1', partyId: 'party-1' }], [{ id: 'party-1' }]]);
    expect(await resolveWalletIdentity(db as never, orgId, { crmContactId: 'contact-1' })).toEqual({
      partyId: 'party-1',
      crmContactId: 'contact-1',
      clientKey: 'party:party-1',
      identityStatus: 'active',
    });
  });

  it('rejects conflicting, missing and dangling facets', async () => {
    const conflicting = createMockDb();
    conflicting.resolveSequence([[{ id: 'party-1' }], [{ id: 'contact-1', partyId: 'party-2' }]]);
    await expect(
      resolveWalletIdentity(conflicting.db as never, orgId, {
        partyId: 'party-1',
        crmContactId: 'contact-1',
      }),
    ).rejects.toMatchObject({ code: 'wallet_identity_changed' });

    const missing = createMockDb();
    missing.resolveSequence([[]]);
    await expect(
      resolveWalletIdentity(missing.db as never, orgId, { partyId: 'party-1' }),
    ).rejects.toMatchObject({ code: 'wallet_identity_unavailable' });

    const dangling = createMockDb();
    dangling.resolveSequence([[{ id: 'contact-1', partyId: 'missing-party' }], []]);
    await expect(
      resolveWalletIdentity(dangling.db as never, orgId, { crmContactId: 'contact-1' }),
    ).rejects.toMatchObject({ code: 'wallet_identity_unavailable' });
  });

  it('normalizes only syntactically valid canonical durable keys', () => {
    const upper = 'PARTY:10000000-0000-4000-8000-000000000001';
    expect(() => canonicalWalletClientKey(upper)).toThrowError(
      expect.objectContaining({ code: 'wallet_identity_required' }),
    );
    expect(canonicalWalletClientKey('party:10000000-0000-4000-8000-0000000000AA')).toBe(
      'party:10000000-0000-4000-8000-0000000000aa',
    );
    for (const value of [null, '', 'party:bad', 'client:10000000-0000-4000-8000-000000000001']) {
      expect(() => canonicalWalletClientKey(value)).toThrowError(
        expect.objectContaining({ code: 'wallet_identity_required' }),
      );
    }
  });

  it('keeps persisted party rows authoritative while contact-only rows follow the active bridge', () => {
    const predicate = walletOwnedPredicate(
      orgId,
      {
        partyId: '10000000-0000-4000-8000-000000000001',
        crmContactId: '20000000-0000-4000-8000-000000000001',
      },
      posClientLedger,
    );
    const query = new PgDialect().sqlToQuery(predicate).sql;
    expect(query).toContain('"pos_client_ledger"."party_id"');
    expect(query).toContain('"pos_client_ledger"."party_id" is null');
    expect(query).toContain('"crm_contacts"."deleted_at" is null');
  });

  it('derives refund locks from persisted party or the current active contact bridge', async () => {
    const noLookup = createMockDb();
    expect(
      await resolvePersistedWalletLockOwner(
        noLookup.db as never,
        orgId,
        { partyId: 'party-1', crmContactId: 'contact-1' },
        { lock: false },
      ),
    ).toEqual({ clientKey: 'party:party-1' });

    const linked = createMockDb();
    linked.resolveSequence([[{ partyId: 'party-2', deletedAt: null }]]);
    expect(
      await resolvePersistedWalletLockOwner(
        linked.db as never,
        orgId,
        { crmContactId: 'contact-1' },
        { lock: false },
      ),
    ).toEqual({ clientKey: 'party:party-2' });
  });

  it('keeps missing and deleted contact-only history refundable under its persisted key', async () => {
    const missing = createMockDb();
    missing.resolveSequence([[]]);
    expect(
      await resolvePersistedWalletLockOwner(
        missing.db as never,
        orgId,
        { crmContactId: 'contact-1' },
        { lock: false },
      ),
    ).toEqual({ clientKey: 'contact:contact-1' });

    const deleted = createMockDb();
    deleted.resolveSequence([[{ partyId: 'party-2', deletedAt: new Date() }]]);
    expect(
      await resolvePersistedWalletLockOwner(
        deleted.db as never,
        orgId,
        { crmContactId: 'contact-1' },
        { lock: false },
      ),
    ).toEqual({ clientKey: 'contact:contact-1' });
  });
});
