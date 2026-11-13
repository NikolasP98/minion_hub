import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import type { FormConfig } from '$lib/doors/kinds/form';

const mocks = vi.hoisted(() => ({
  resolvePublicDoor: vi.fn(),
  bumpDoorStat: vi.fn(),
  ensureCrmContact: vi.fn(),
  upsertNotification: vi.fn(),
  put: vi.fn(),
  assertOrgQuota: vi.fn(),
  bustCrmList: vi.fn(),
}));

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: { db: unknown }, fn: (tx: unknown) => unknown) => fn(ctx.db),
}));
vi.mock('./doors.service', () => ({
  resolvePublicDoor: mocks.resolvePublicDoor,
  bumpDoorStat: mocks.bumpDoorStat,
}));
vi.mock('./inbox/inbox.service', () => ({ upsertNotification: mocks.upsertNotification }));
vi.mock('./crm-contact-ensure', () => ({ ensureCrmContact: mocks.ensureCrmContact }));
vi.mock('./crm-contacts.service', () => ({ bustCrmList: mocks.bustCrmList }));
vi.mock('$server/storage/blob', () => ({ getStorage: () => ({ put: mocks.put }) }));
vi.mock('./file.service', async () => ({
  ...(await import('$lib/attachments/limits')),
  assertOrgQuota: mocks.assertOrgQuota,
}));

import {
  listSubmissions,
  maskSubmissionValues,
  sameName,
  submitFormDoor,
  uploadDoorFile,
} from './doors-form.service';

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
const execute = vi.fn(async (_q: SQL): Promise<unknown[]> => []);
const tx = { insert: vi.fn(() => ({ values: values$ })), execute };
const dialect = new PgDialect();
/** The raw statements submitFormDoor ran, rendered: [sql text, params]. */
const executed = () => execute.mock.calls.map(([q]) => dialect.sqlToQuery(q));
const door = (over: Record<string, unknown> = {}) => ({
  ctx: { db: tx, tenantId: 'org-1' },
  door: {
    id: DOOR,
    orgId: 'org-1',
    kind: 'form',
    slug: 'qa-intake',
    title: 'Intake',
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
  mocks.assertOrgQuota.mockResolvedValue({ ok: true });
});

describe('door tags and files', () => {
  const TAG = '207440ff-2d42-4e5f-adf3-41f8e59f9601';
  const FILE_A = 'a'.repeat(24);
  const FILE_B = 'b'.repeat(24);
  const casting: FormConfig = {
    fields: [
      ...config.fields,
      { key: 'foto', label: 'Foto', type: 'file', required: true, accept: 'image' },
      { key: 'adjuntos', label: 'Adjuntos', type: 'file', required: false, maxFiles: 3 },
    ],
    consentText: 'Acepto.',
    consentRequired: true,
    tagIds: [TAG],
  };
  const send = (extra: object) =>
    submitFormDoor('qa-intake', { values: { ...values, ...extra }, consent: true }, NOW);

  beforeEach(() => mocks.resolvePublicDoor.mockResolvedValue(door({ config: casting })));

  it('tags the contact (new or matched) with the door tags, scoped to manual customer tags of the org', async () => {
    mocks.ensureCrmContact.mockResolvedValue({ id: CONTACT, created: false });
    execute.mockImplementation(async (q) =>
      dialect.sqlToQuery(q).sql.includes('attachment_links') ? [{ file_id: FILE_A }] : [],
    );
    expect((await send({ foto: [FILE_A] })).status).toBe('ok');
    const tag = executed().find((q) => q.sql.includes('crm_contact_tags'))!;
    expect(tag.sql).toMatch(/t\.scope = 'crm' and t\.kind = 'manual'/);
    expect(tag.params).toEqual(['org-1', CONTACT, 'org-1', TAG]);
    expect(mocks.bustCrmList).toHaveBeenCalledWith('org-1');
  });

  it('links uploaded files to the contact; only fresh, unlinked door uploads of this org qualify', async () => {
    execute.mockImplementation(async (q) =>
      dialect.sqlToQuery(q).sql.includes('attachment_links')
        ? [{ file_id: FILE_A }, { file_id: FILE_B }]
        : [],
    );
    expect((await send({ foto: [FILE_A], adjuntos: [FILE_B] })).status).toBe('ok');
    const claim = executed().find((q) => q.sql.includes('insert into attachment_links'))!;
    expect(claim.sql).toMatch(/f\.uploaded_by is null/);
    expect(claim.sql).toMatch(/not exists \(select 1 from attachment_links/);
    expect(claim.params).toEqual(['org-1', 'org-1', FILE_A, FILE_B, 'org-1', CONTACT]);
    expect(inserted().payload).toMatchObject({ foto: [FILE_A], adjuntos: [FILE_B] });
  });

  it('a file id that cannot be claimed rejects the submission and names only that field', async () => {
    execute.mockImplementation(async (q) =>
      dialect.sqlToQuery(q).sql.includes('attachment_links') ? [{ file_id: FILE_A }] : [],
    );
    const r = await send({ foto: [FILE_A], adjuntos: [FILE_B] });
    expect(r).toEqual({ status: 'invalid', errors: { adjuntos: 'invalid' } });
    expect(values$).not.toHaveBeenCalled();
    expect(mocks.bumpDoorStat).not.toHaveBeenCalled();
    expect(mocks.upsertNotification).not.toHaveBeenCalled();
  });

  it('files without a contact to hold them are rejected', async () => {
    mocks.ensureCrmContact.mockResolvedValue(null);
    expect(await send({ foto: [FILE_A] })).toEqual({
      status: 'invalid',
      errors: { foto: 'invalid' },
    });
  });

  describe('uploadDoorFile', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
    const up = (over: object = {}) =>
      uploadDoorFile('qa-intake', {
        field: 'foto',
        fileName: '../../mi foto (1).JPG',
        contentType: 'image/jpeg; charset=binary',
        data: jpeg,
        ...over,
      });

    it('stores the file under the org with no uploader, CRM-only, and a safe key', async () => {
      const r = await up();
      expect(r.status).toBe('ok');
      const [file, state] = values$.mock.calls.map(([row]) => row);
      expect(file).toMatchObject({
        tenantId: 'org-1',
        uploadedBy: null,
        category: 'attachment',
        contentType: 'image/jpeg',
        sizeBytes: 3,
        fileName: '.._.._mi foto _1_.JPG',
      });
      expect(file.b2FileKey).toBe(`org-1/attachments/${file.id}/.._.._mi foto _1_.JPG`);
      expect(state).toMatchObject({ fileId: file.id, orgId: 'org-1', accessModules: ['crm'] });
      expect(mocks.put).toHaveBeenCalledWith(file.b2FileKey, jpeg, 'image/jpeg');
    });

    it('refuses unknown fields, wrong types, oversized files, a full quota and unknown doors, storing nothing', async () => {
      expect(await up({ field: 'nombre' })).toEqual({ status: 'invalid_field' });
      expect(await up({ contentType: 'application/pdf' })).toEqual({ status: 'mime_not_allowed' });
      expect(await up({ field: 'adjuntos', contentType: 'application/x-msdownload' })).toEqual({
        status: 'mime_not_allowed',
      });
      expect(await up({ data: new Uint8Array(4 * 1024 * 1024 + 1) })).toEqual({
        status: 'too_large',
      });
      mocks.assertOrgQuota.mockResolvedValueOnce({ ok: false, code: 'quota_exceeded' });
      expect(await up()).toEqual({ status: 'quota_exceeded' });
      mocks.resolvePublicDoor.mockResolvedValueOnce(null);
      expect(await up()).toEqual({ status: 'not_found' });
      expect(values$).not.toHaveBeenCalled();
      expect(mocks.put).not.toHaveBeenCalled();
    });

    it('a config this build cannot read (unknown top-level or field key) is not_found, storing nothing', async () => {
      mocks.resolvePublicDoor.mockResolvedValueOnce(door({ config: { ...casting, embed: true } }));
      expect(await up()).toEqual({ status: 'not_found' });
      const fields = casting.fields.map((f) => ({ ...f, width: 'half' }));
      mocks.resolvePublicDoor.mockResolvedValueOnce(door({ config: { ...casting, fields } }));
      expect(await up()).toEqual({ status: 'not_found' });
      expect(values$).not.toHaveBeenCalled();
      expect(mocks.put).not.toHaveBeenCalled();
    });
  });
});

describe('submitFormDoor', () => {
  const withProfile = {
    ...config,
    fields: [
      ...config.fields,
      { key: 'dni', label: 'DNI', type: 'text' as const, required: false },
      { key: 'instagram', label: 'Instagram', type: 'text' as const, required: false },
    ],
  };

  it('a trusted DNI already in the CRM reuses that contact even with a new phone; only missing handles are added', async () => {
    mocks.resolvePublicDoor.mockResolvedValueOnce(door({ config: withProfile }));
    execute.mockResolvedValueOnce([{ id: 'dni-match', name: 'Otra Persona', trusted: true }]);
    const r = await submitFormDoor(
      'qa-intake',
      {
        values: { ...values, dni: ' 4567-8901 ', instagram: 'https://instagram.com/Ana.Prueba/' },
        consent: true,
      },
      NOW,
    );
    expect(r.status).toBe('ok');
    expect(mocks.ensureCrmContact).not.toHaveBeenCalled();
    expect(inserted().contactId).toBe('dni-match');
    const [lookup, fill] = executed();
    expect(lookup.sql).toContain('p.doc_number');
    // Trusted rows sort first in SQL, so the limit can never cut them off.
    expect(lookup.sql).toMatch(/order by trusted desc, c\.created_at\s+limit 20/);
    // A DNI typed into a door is flagged untrusted, so it needs the name as well.
    expect(lookup.sql).toMatch(/or coalesce\(c\.source, ''\) not like 'door:%'\) as trusted/);
    expect(lookup.params).toEqual(['45678901', 'org-1', '45678901', '45678901']);
    // `new || existing`: the handle fills a gap only, and the DNI is never written onto it.
    expect(fill.sql).toMatch(/set custom_fields = \$1::jsonb \|\| coalesce\(custom_fields/);
    expect(fill.params).toEqual([
      JSON.stringify({ instagram: 'ana.prueba' }),
      'dni-match',
      'org-1',
    ]);
    expect(inserted().payload).toMatchObject({ dni: '4567-8901' });
  });

  it('a DNI from an earlier door submission matches only when the name agrees', async () => {
    const send = () =>
      submitFormDoor(
        'qa-intake',
        { values: { ...values, nombre: 'ana PRUEBA', dni: '45678901' }, consent: true },
        NOW,
      );
    mocks.resolvePublicDoor.mockResolvedValue(door({ config: withProfile }));
    execute.mockResolvedValueOnce([
      { id: 'other', name: 'Luis Gómez', trusted: false },
      { id: 'returning', name: 'Ana María Prueba', trusted: false },
    ]);
    await send();
    expect(mocks.ensureCrmContact).not.toHaveBeenCalled();
    expect(inserted().contactId).toBe('returning');
    // Only the lookup ran: a matched contact never receives the DNI.
    expect(executed()).toHaveLength(1);

    vi.clearAllMocks();
    mocks.ensureCrmContact.mockResolvedValueOnce({ id: CONTACT, created: true });
    execute.mockResolvedValueOnce([{ id: 'other', name: 'Luis Gómez', trusted: false }]);
    await send();
    expect(mocks.ensureCrmContact).toHaveBeenCalledOnce();
    expect(inserted().contactId).toBe(CONTACT);
  });

  it('a phone/email-matched existing contact gets missing handles but never the DNI', async () => {
    mocks.resolvePublicDoor.mockResolvedValueOnce(door({ config: withProfile }));
    mocks.ensureCrmContact.mockResolvedValueOnce({ id: CONTACT, created: false });
    await submitFormDoor(
      'qa-intake',
      { values: { ...values, instagram: '@ana' }, consent: true },
      NOW,
    );
    const [fill] = executed();
    expect(fill.params).toEqual([JSON.stringify({ instagram: 'ana' }), CONTACT, 'org-1']);
    expect(inserted().contactId).toBe(CONTACT);
  });

  it('sameName: two shared words required, accents and case ignored', () => {
    expect(sameName('María Pérez', 'MARIA PEREZ GOMEZ')).toBe(true);
    expect(sameName('Ana', 'Ana Prueba')).toBe(false);
    expect(sameName('Ana Prueba', 'Ana Gómez')).toBe(false);
    expect(sameName(null, 'Ana')).toBe(false);
  });

  it('an unknown DNI falls back to phone/email; a NEW contact gets the DNI and handles', async () => {
    mocks.resolvePublicDoor.mockResolvedValueOnce(door({ config: withProfile }));
    await submitFormDoor(
      'qa-intake',
      { values: { ...values, dni: '45678901' }, consent: true },
      NOW,
    );
    expect(mocks.ensureCrmContact).toHaveBeenCalledOnce();
    expect(inserted().contactId).toBe(CONTACT);
    const [, fill] = executed();
    // `new || existing`: keys already on the row win.
    expect(fill.sql).toMatch(/set custom_fields = \$1::jsonb \|\| coalesce\(custom_fields/);
    expect(fill.params).toEqual([JSON.stringify({ dni: '45678901' }), CONTACT, 'org-1']);
  });

  it('placeholder DNIs are not keys, and a form without DNI/socials runs no extra query', async () => {
    mocks.resolvePublicDoor.mockResolvedValueOnce(door({ config: withProfile }));
    await submitFormDoor(
      'qa-intake',
      { values: { ...values, dni: '00000000' }, consent: true },
      NOW,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(mocks.ensureCrmContact).toHaveBeenCalledOnce();
    await submitFormDoor('qa-intake', { values, consent: true }, NOW);
    expect(execute).not.toHaveBeenCalled();
  });

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

  it('a config this build cannot read (unknown top-level or field key) is not_found, nothing written', async () => {
    mocks.resolvePublicDoor.mockResolvedValueOnce(door({ config: { ...config, embed: true } }));
    expect(await submitFormDoor('qa-intake', { values, consent: true })).toEqual({
      status: 'not_found',
    });
    const fields = config.fields.map((f) => ({ ...f, width: 'half' }));
    mocks.resolvePublicDoor.mockResolvedValueOnce(door({ config: { ...config, fields } }));
    expect(await submitFormDoor('qa-intake', { values, consent: true })).toEqual({
      status: 'not_found',
    });
    expect(mocks.ensureCrmContact).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mocks.bumpDoorStat).not.toHaveBeenCalled();
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
      id: expect.any(String),
      orgId: 'org-1',
      doorId: DOOR,
      contactId: CONTACT,
      payload: values,
      consent: true,
      consentText: 'Acepto.',
      attribution,
    });
    const n = mocks.upsertNotification.mock.calls[0]![1];
    expect(n).toMatchObject({
      scope: 'role',
      capability: 'crm:manage',
      kind: 'crm.door_submission',
    });
    expect(n.subjectId).toBe(inserted().id);
    expect(n.body).toBe('Intake · Ana Prueba');
    expect(JSON.stringify(n)).not.toMatch(/penicilina|900 000 041/);
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
