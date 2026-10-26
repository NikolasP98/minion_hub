import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import type { FormConfig } from '$lib/doors/kinds/form';

const mocks = vi.hoisted(() => ({
  resolvePublicDoor: vi.fn(),
  bumpDoorStat: vi.fn(),
  ensureCrmContact: vi.fn(),
}));

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: { db: unknown }, fn: (tx: unknown) => unknown) => fn(ctx.db),
}));
vi.mock('./doors.service', () => ({
  resolvePublicDoor: mocks.resolvePublicDoor,
  bumpDoorStat: mocks.bumpDoorStat,
}));
vi.mock('./crm-contact-ensure', () => ({ ensureCrmContact: mocks.ensureCrmContact }));

import { listSubmissions, maskSubmissionValues, submitFormDoor } from './doors-form.service';

const DOOR = '11111111-2222-4333-8444-555555555555';
const CONTACT = '22222222-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-25T10:00:00Z');
const config: FormConfig = {
  fields: [
    { key: 'nombre', label: 'Nombre', type: 'text', required: true },
    { key: 'telefono', label: 'Teléfono', type: 'phone', required: true },
    { key: 'motivo', label: 'Motivo', type: 'select', required: true, options: ['Botox', 'Otro'] },
    { key: 'historia', label: 'Antecedentes', type: 'textarea', required: false },
  ],
  consentText: 'Acepto.',
  consentRequired: true,
  successMessage: 'Gracias, te llamamos pronto.',
};
const values = {
  nombre: 'Ana Prueba',
  telefono: '+51 900 000 041',
  motivo: 'Botox',
  historia: 'Alergia a la penicilina',
};

let mock: ReturnType<typeof createMockDb>;
// submitFormDoor's tx only inserts the submission: a two-call fake records it.
const values$ = vi.fn(async (_row: Record<string, unknown>) => undefined);
const tx = { insert: vi.fn(() => ({ values: values$ })) };
const door = (over: Record<string, unknown> = {}) => ({
  ctx: { db: tx, tenantId: 'org-1' },
  door: {
    id: DOOR,
    orgId: 'org-1',
    kind: 'form',
    slug: 'qa-intake',
    active: true,
    config,
    ...over,
  },
});
const inserted = () => values$.mock.calls[0]?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  mock = createMockDb();
  mocks.resolvePublicDoor.mockResolvedValue(door());
  mocks.ensureCrmContact.mockResolvedValue({ id: CONTACT, created: true });
});

describe('submitFormDoor', () => {
  it('unknown, off and non-form doors are all not_found, and nothing is written', async () => {
    mocks.resolvePublicDoor.mockResolvedValueOnce(null);
    expect(await submitFormDoor('nope', { values, consent: true })).toEqual({
      status: 'not_found',
    });
    mocks.resolvePublicDoor.mockResolvedValueOnce(door({ kind: 'faq' }));
    expect((await submitFormDoor('qa-faq', { values, consent: true })).status).toBe('not_found');
    expect(mocks.ensureCrmContact).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('missing consent → field error, no contact, no submission, no counter', async () => {
    const r = await submitFormDoor('qa-intake', { values, consent: false });
    expect(r).toEqual({ status: 'invalid', errors: { consent: 'required' } });
    expect(mocks.ensureCrmContact).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mocks.bumpDoorStat).not.toHaveBeenCalled();
  });

  it('invalid values → per-field codes only (never the value)', async () => {
    const r = await submitFormDoor('qa-intake', {
      values: { ...values, telefono: 'secret-not-a-phone' },
      consent: true,
    });
    expect(r).toEqual({ status: 'invalid', errors: { telefono: 'invalid' } });
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('finds or creates the contact with the door source and first touch, stores the submission, bumps submissions', async () => {
    const attribution = {
      door: `door:${DOOR}` as const,
      utm_source: 'instagram',
      at: NOW.toISOString(),
    };
    const r = await submitFormDoor(
      'qa-intake',
      { values: { ...values, injected: 'x' }, consent: true, attribution },
      NOW,
    );
    expect(r).toEqual({ status: 'ok', message: 'Gracias, te llamamos pronto.' });
    expect(mocks.ensureCrmContact).toHaveBeenCalledWith(tx, 'org-1', {
      name: 'Ana Prueba',
      phone: '+51 900 000 041',
      email: null,
      source: 'door:qa-intake',
      firstTouch: attribution,
    });
    expect(inserted()).toEqual({
      orgId: 'org-1',
      doorId: DOOR,
      contactId: CONTACT,
      payload: values,
      consent: true,
      consentText: 'Acepto.',
      attribution,
    });
    expect(mocks.bumpDoorStat).toHaveBeenCalledWith(
      expect.anything(),
      `door:${DOOR}`,
      'submissions',
      NOW,
    );
  });

  it('an attribution captured for another door is replaced by this door + time', async () => {
    const other = {
      door: 'door:99999999-2222-4333-8444-555555555555' as const,
      utm_source: 'x',
      at: NOW.toISOString(),
    };
    await submitFormDoor('qa-intake', { values, consent: true, attribution: other }, NOW);
    const expected = { door: `door:${DOOR}`, at: NOW.toISOString() };
    expect(mocks.ensureCrmContact.mock.calls[0][2].firstTouch).toEqual(expected);
    expect(inserted().attribution).toEqual(expected);
  });

  it('a matched contact (or none) still stores the submission; consent not required stores no consent text', async () => {
    mocks.resolvePublicDoor.mockResolvedValueOnce(
      door({ config: { ...config, consentRequired: false } }),
    );
    mocks.ensureCrmContact.mockResolvedValueOnce(null);
    expect((await submitFormDoor('qa-intake', { values, consent: false })).status).toBe('ok');
    expect(inserted()).toMatchObject({ contactId: null, consent: false, consentText: null });
  });
});

describe('maskSubmissionValues', () => {
  it('masks free text, phone and unknown keys; keeps select and checkbox answers', () => {
    const masked = maskSubmissionValues(config.fields, { ...values, removed_field: 'Lima 123' });
    expect(masked.motivo).toBe('Botox');
    expect(masked.historia).not.toContain('penicilina');
    expect(masked.telefono).toBe('•••••••• 041');
    expect(masked.removed_field).not.toContain('Lima');
  });
});

describe('listSubmissions', () => {
  const row = (i: number) => ({
    id: `0000000${i}-2222-4333-8444-555555555555`,
    createdAt: new Date(NOW.getTime() - i * 60_000),
    contactId: CONTACT,
    contactName: 'Ana',
    consent: true,
    payload: values,
    attribution: { door: `door:${DOOR}`, utm_source: 'instagram', at: NOW.toISOString() },
  });

  it('pages with a cursor and masks when asked', async () => {
    mock.resolve([row(1), row(2), row(3)]);
    const ctx = { db: mock.db, tenantId: 'org-1' } as never;
    const page = await listSubmissions(ctx, { id: DOOR, config }, { limit: 2, mask: true });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBe(`${row(2).createdAt.toISOString()}_${row(2).id}`);
    expect(page.rows[0].values.historia).not.toContain('penicilina');
    expect(page.rows[0].attribution).toEqual({ utm_source: 'instagram' });
  });

  it('returns raw values unmasked and no cursor on the last page', async () => {
    mock.resolve([row(1)]);
    const ctx = { db: mock.db, tenantId: 'org-1' } as never;
    const page = await listSubmissions(ctx, { id: DOOR, config }, { mask: false, cursor: 'junk' });
    expect(page.rows[0].values).toEqual(values);
    expect(page.nextCursor).toBeNull();
  });
});
