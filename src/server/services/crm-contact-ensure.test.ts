import { describe, expect, it, vi } from 'vitest';
import { crmContacts, crmContactIdentities } from '$server/db/pg-crm-schema';
import type { CoreTx } from '$server/db/with-org-core';
import { ensureCrmContact, resolveCrmContact } from './crm-contact-ensure';

/** Minimal tx: `execute` answers the identity lookup, `insert` records values. */
function fakeTx(matchId: string | null) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const execute = vi.fn(async () => (matchId ? [{ contact_id: matchId }] : []));
  const insert = vi.fn((table: unknown) => ({
    values: (values: unknown) => {
      inserts.push({ table, values });
      return {
        returning: async () => [{ id: 'new-contact' }],
        onConflictDoNothing: async () => undefined,
      };
    },
  }));
  return { tx: { execute, insert } as unknown as CoreTx, execute, inserts };
}

const TOUCH = {
  door: 'door:11111111-2222-4333-8444-555555555555',
  at: '2026-10-25T10:00:00.000Z',
} as const;

describe('resolveCrmContact', () => {
  it('skips the lookup when there is nothing to match on', async () => {
    const { tx, execute } = fakeTx('x');
    expect(await resolveCrmContact(tx, 'org', '123', '  ')).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('matches by last-9 phone and by email', async () => {
    expect(await resolveCrmContact(fakeTx('c1').tx, 'org', '+51 900 000 041', null)).toBe('c1');
    expect(await resolveCrmContact(fakeTx('c2').tx, 'org', null, 'A@B.pe')).toBe('c2');
  });
});

describe('ensureCrmContact', () => {
  it('reuses an existing contact and never writes first_touch on it', async () => {
    const { tx, inserts } = fakeTx('existing');
    const out = await ensureCrmContact(tx, 'org', {
      phone: '900000041',
      source: 'door:qa-intake',
      firstTouch: TOUCH,
    });
    expect(out).toEqual({ id: 'existing', created: false });
    expect(inserts).toEqual([]);
  });

  it('creates the contact with source, first_touch and E.164 + email identities', async () => {
    const { tx, inserts } = fakeTx(null);
    const out = await ensureCrmContact(tx, 'org', {
      name: ' Ana ',
      phone: '+51 900 000 041',
      email: 'Ana@X.pe',
      source: 'door:qa-intake',
      firstTouch: TOUCH,
    });
    expect(out).toEqual({ id: 'new-contact', created: true });
    expect(inserts[0]).toEqual({
      table: crmContacts,
      values: { orgId: 'org', displayName: 'Ana', source: 'door:qa-intake', firstTouch: TOUCH },
    });
    expect(inserts[1].table).toBe(crmContactIdentities);
    expect(inserts[1].values).toEqual([
      expect.objectContaining({ channel: 'whatsapp', externalId: '+51900000041' }),
      expect.objectContaining({ channel: 'email', externalId: 'ana@x.pe' }),
    ]);
  });

  it('omits first_touch when none is given (internal bookings)', async () => {
    const { tx, inserts } = fakeTx(null);
    await ensureCrmContact(tx, 'org', { email: 'a@b.pe', source: 'booking' });
    expect(inserts[0].values).toEqual({ orgId: 'org', displayName: null, source: 'booking' });
  });

  it('returns null when there is nothing to identify the person by', async () => {
    const { tx, inserts } = fakeTx(null);
    expect(
      await ensureCrmContact(tx, 'org', { name: 'X', phone: '12', source: 'booking' }),
    ).toBeNull();
    expect(inserts).toEqual([]);
  });
});
