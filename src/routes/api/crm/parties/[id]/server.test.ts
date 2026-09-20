import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `PATCH /api/crm/parties/[id]` — the CRM's ONE party-edit path.
 *
 * Covers the phone half added for the POS customer card (§31.1/§32.3): a client
 * already on file with no phone books a reminder-less appointment, and the till
 * could not fix it. The number must reach the party spine NORMALIZED (phone9),
 * because that column is also a dedup key.
 */
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
}));

const setPhoneMock = vi.fn<(id: string, phone: string) => Promise<string | null>>(
  async () => '992376833',
);
const setVerifiedMock = vi.fn<(id: string, v: boolean) => Promise<boolean>>(async () => true);
type DocResult =
  | { ok: true; docNumber: string; docType: 'DNI' | 'RUC' }
  | { ok: false; reason: 'invalid' | 'taken' | 'not_found' };
const setDocMock = vi.fn<(id: string, doc: string) => Promise<DocResult>>(async () => ({
  ok: true,
  docNumber: '48340990',
  docType: 'DNI',
}));
const getPartyMock = vi.fn<(id: string) => Promise<Record<string, unknown> | null>>(async (id) => ({
  id,
  name: 'Abigail',
  type: 'person',
  email: null,
  docNumber: '48340990',
  phone9: '997155739',
  dniVerified: true,
  metadata: { secret: 'never-served' },
}));
vi.mock('$server/services/party.service', () => ({
  setPartyPhone: (_ctx: unknown, id: string, phone: string) => setPhoneMock(id, phone),
  setPartyDniVerified: (_ctx: unknown, id: string, v: boolean) => setVerifiedMock(id, v),
  setPartyDocument: (_ctx: unknown, id: string, doc: string) => setDocMock(id, doc),
  getParty: (_ctx: unknown, id: string) => getPartyMock(id),
}));

const PARTY = '11111111-2222-3333-4444-555555555555';

async function call(id: string, body: unknown) {
  const { PATCH } = await import('./+server');
  return PATCH({
    locals: {} as App.Locals,
    params: { id },
    request: new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }),
  } as unknown as Parameters<typeof PATCH>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setPhoneMock.mockImplementation(async () => '992376833');
  setVerifiedMock.mockImplementation(async () => true);
  setDocMock.mockImplementation(async () => ({ ok: true, docNumber: '48340990', docType: 'DNI' }));
});

describe('PATCH /api/crm/parties/[id]', () => {
  it('writes a phone onto an existing party and answers the stored value', async () => {
    const res = await call(PARTY, { phone: '+51 992 376 833' });
    expect(setPhoneMock).toHaveBeenCalledWith(PARTY, '+51 992 376 833');
    expect(await res.json()).toEqual({ ok: true, phone: '992376833' });
  });

  it('still serves the verified-checkmark body it was built for', async () => {
    const res = await call(PARTY, { dniVerified: true });
    expect(setVerifiedMock).toHaveBeenCalledWith(PARTY, true);
    expect(setPhoneMock).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, dniVerified: true });
  });

  it('refuses a phone the spine cannot key on, without writing', async () => {
    setPhoneMock.mockImplementation(async () => null); // phone9() said too short
    await expect(call(PARTY, { phone: '123' })).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a body that asks for nothing, and a non-uuid id', async () => {
    await expect(call(PARTY, {})).rejects.toMatchObject({ status: 400 });
    await expect(call('not-a-uuid', { phone: '992376833' })).rejects.toMatchObject({ status: 400 });
    expect(setPhoneMock).not.toHaveBeenCalled();
  });

  // ── identity document (POS customer card "Add document") ──
  it('writes a document onto an existing party and answers the stored digits', async () => {
    const res = await call(PARTY, { docNumber: '48340990' });
    expect(setDocMock).toHaveBeenCalledWith(PARTY, '48340990');
    expect(setPhoneMock).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, docNumber: '48340990' });
  });

  it('answers 400 for a non-document and 409 when another client holds it', async () => {
    setDocMock.mockImplementation(async () => ({ ok: false, reason: 'invalid' }));
    await expect(call(PARTY, { docNumber: '1234' })).rejects.toMatchObject({ status: 400 });
    setDocMock.mockImplementation(async () => ({ ok: false, reason: 'taken' }));
    await expect(call(PARTY, { docNumber: '48340990' })).rejects.toMatchObject({ status: 409 });
    setDocMock.mockImplementation(async () => ({ ok: false, reason: 'not_found' }));
    await expect(call(PARTY, { docNumber: '48340990' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('GET /api/crm/parties/[id]', () => {
  async function get(id: string) {
    const { GET } = await import('./+server');
    return GET({ locals: {} as App.Locals, params: { id } } as unknown as Parameters<
      typeof GET
    >[0]);
  }

  it('serves the picker-row shape of one party, nothing more', async () => {
    const res = await get(PARTY);
    expect(await res.json()).toEqual({
      id: PARTY,
      name: 'Abigail',
      type: 'person',
      email: null,
      docNumber: '48340990',
      phone9: '997155739',
      dniVerified: true,
    });
  });

  it('answers 404 for an unknown party and 400 for a non-uuid id', async () => {
    getPartyMock.mockImplementation(async () => null);
    await expect(get(PARTY)).rejects.toMatchObject({ status: 404 });
    await expect(get('nope')).rejects.toMatchObject({ status: 400 });
  });
});
