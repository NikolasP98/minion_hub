import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The split-identity hole QA found: POS quick-add writes only the PARTY spine
 * (`POST /api/crm/parties`), so a package sold to a brand-new POS client mints a
 * grant carrying `party_id` with `crm_contact_id = null`. Any later read keyed
 * on the CRM facet — and `/api/pos/packages/grants?crmContactId=` accepts one —
 * matched nothing, so the client's paid sessions were unreachable and the
 * spec's core flow (sell a package, then book its sessions) dead-ended.
 *
 * `widenClient` closes it once, at the read boundary, by resolving the missing
 * facet through `crm_contacts.party_id`. These tests pin BOTH directions and the
 * fail-soft cases, because every account/grant/plan read now depends on it.
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
  getPosSettings: async () => ({ currency: 'PEN' }),
}));

/** Captures the WHERE the caller built, so the OR can be asserted structurally. */
let rows: unknown[] = [];
const tx = {
  select: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ['from', 'where']) chain[k] = () => chain;
    chain.limit = () => Promise.resolve(rows);
    return chain;
  },
};

import { widenClient, clientMatch } from './pos-accounts.service';

const ORG = 'org-1';

beforeEach(() => {
  rows = [];
});

describe('widenClient — either facet finds the other', () => {
  it('resolves the party spine from a CRM contact (the read that was broken)', async () => {
    rows = [{ partyId: 'party-1' }];
    expect(await widenClient(tx as never, ORG, { crmContactId: 'contact-1' })).toEqual({
      crmContactId: 'contact-1',
      partyId: 'party-1',
    });
  });

  it('resolves the CRM contact from a bare party (the POS quick-add case)', async () => {
    rows = [{ id: 'contact-1' }];
    expect(await widenClient(tx as never, ORG, { partyId: 'party-1' })).toEqual({
      partyId: 'party-1',
      crmContactId: 'contact-1',
    });
  });

  it('leaves a party-only client alone when no CRM contact bridges to it', async () => {
    rows = [];
    expect(await widenClient(tx as never, ORG, { partyId: 'party-1' })).toEqual({
      partyId: 'party-1',
    });
  });

  it('leaves a contact whose bridge column is null alone', async () => {
    rows = [{ partyId: null }];
    expect(await widenClient(tx as never, ORG, { crmContactId: 'contact-1' })).toEqual({
      crmContactId: 'contact-1',
    });
  });

  it('does not re-query when both facets are already known', async () => {
    rows = [{ id: 'SHOULD-NOT-BE-USED' }];
    expect(
      await widenClient(tx as never, ORG, { partyId: 'party-1', crmContactId: 'contact-1' }),
    ).toEqual({ partyId: 'party-1', crmContactId: 'contact-1' });
  });

  it('still refuses a ref carrying no identity at all', async () => {
    await expect(widenClient(tx as never, ORG, {})).rejects.toMatchObject({
      code: 'client_required',
    });
  });
});

describe('a widened ref matches rows stamped with EITHER facet', () => {
  const cols = {
    partyId: { name: 'party_id' },
    crmContactId: { name: 'crm_contact_id' },
  } as never;

  it('builds a two-sided predicate once widened, a one-sided one before', () => {
    // Before widening: a contact-keyed read can only see contact-stamped rows —
    // this is exactly what missed the party-only grant.
    const narrow = clientMatch({ crmContactId: 'contact-1' }, cols);
    // After widening it carries both, so the party-stamped grant matches too.
    const wide = clientMatch({ crmContactId: 'contact-1', partyId: 'party-1' }, cols);

    const sqlOf = (q: unknown) => JSON.stringify(q);
    expect(sqlOf(narrow)).not.toEqual(sqlOf(wide));
    // The widened predicate mentions both columns; the narrow one only mentions its own.
    expect(sqlOf(wide)).toContain('party_id');
    expect(sqlOf(wide)).toContain('crm_contact_id');
    expect(sqlOf(narrow)).not.toContain('party_id');
  });
});
