import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guard for the CRM detail page's "look up this DNI" apply.
 *
 * The bug: the UI applied a registry hit into client-side form drafts, but
 * doc_number / dob / sex / official name are PARTY columns and the details form
 * only PATCHes crm_contacts.custom_fields — so saving DROPPED the DNI, never
 * wrote the date of birth, and persisted sex as a localized label ("Male").
 * applyContactDni is the single writer that fixes all three; these assertions
 * fail if any of the three stops being written.
 */

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));
vi.mock('@minion-stack/cache', () => ({
  invalidateTags: () => Promise.resolve(),
  tags: { tenantDomain: () => ['crm'] },
}));

const PERSON = {
  id: '60525600',
  nombres: 'RENZO ALONSO',
  apellido_paterno: 'GRANDA',
  apellido_materno: 'TORO',
  nombre_completo: 'RENZO ALONSO GRANDA TORO',
  genero: 'M',
  fecha_nacimiento: '18/06/1990',
  codigo_verificacion: '7',
};
let lookupResult: unknown = { status: 'found', person: PERSON };

vi.mock('@minion-stack/crm-sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  lookupDni: () => Promise.resolve(lookupResult),
}));

/** Rows each successive `select()` chain resolves to, in call order. */
let selectQueue: unknown[][] = [];
let executed: string[] = [];
const chain = () => {
  const c: Record<string, unknown> = {};
  for (const k of ['from', 'where', 'orderBy']) c[k] = () => c;
  c.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  return c;
};
const tx = {
  select: () => chain(),
  execute: (q: unknown) => {
    executed.push(JSON.stringify(q));
    return Promise.resolve([]);
  },
};

import { applyContactDni } from './party.service';

const ctx = { db: {} as never, tenantId: 'org-1' };

beforeEach(() => {
  executed = [];
  lookupResult = { status: 'found', person: PERSON };
  selectQueue = [
    [{ partyId: 'party-1', name: 'RENZO GRANDA TORO' }], // the contact
    [], // no other party holds this document
  ];
});

describe('applyContactDni', () => {
  it('writes doc_number, dob and canonical sex onto the party spine', async () => {
    const res = await applyContactDni(ctx, 'contact-1', '60525600', 'k');
    expect(res).toEqual({ ok: true, verified: true });

    const sql = executed.join('\n');
    expect(sql).toContain('60525600'); // the DNI is persisted at all…
    expect(sql).toContain('doc_number');
    expect(sql).toContain('1990-06-18'); // …dd/mm/yyyy parsed to a real date…
    expect(sql).toContain('dni_verified');
    // …and sex reaches the DB as canonical 'M', never a localized label.
    expect(sql).toContain('sex\\":\\"M');
    expect(sql).not.toMatch(/sex\\":\\"(Male|Hombre)/);
  });

  it('stores an unverified document when the registry has no match', async () => {
    lookupResult = { status: 'not_found' };
    const res = await applyContactDni(ctx, 'contact-1', '60525600', 'k');
    expect(res).toEqual({ ok: true, verified: false });
    expect(executed.join('\n')).toContain('60525600');
  });

  it('refuses a document that already belongs to another party', async () => {
    selectQueue[1] = [{ id: 'party-2' }];
    const res = await applyContactDni(ctx, 'contact-1', '60525600', 'k');
    expect(res).toEqual({ ok: false, reason: 'conflict' });
    expect(executed).toHaveLength(0); // nothing written
  });

  it('reports a registry outage instead of clearing verification', async () => {
    lookupResult = { status: 'error', message: 'boom' };
    const res = await applyContactDni(ctx, 'contact-1', '60525600', 'k');
    expect(res).toEqual({ ok: false, reason: 'error' });
    expect(executed).toHaveLength(0);
  });
});
