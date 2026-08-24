import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCoreCtx = vi.fn();
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: () => mockGetCoreCtx() }));

const mockOwnerFilter = vi.fn(async () => undefined);
const mockShouldMask = vi.fn(async () => false);
vi.mock('$server/services/rbac.service', () => ({
  ownerFilter: () => mockOwnerFilter(),
  shouldMaskSensitive: () => mockShouldMask(),
}));

const mockRankContactsPage = vi.fn();
const mockListTags = vi.fn(async () => [] as unknown[]);
vi.mock('$server/services/crm-contacts.service', () => ({
  ROSTER_CAP: 50_000,
  rankContactsPage: (...a: unknown[]) => mockRankContactsPage(...a),
  rankContactsPageCached: (...a: unknown[]) => mockRankContactsPage(...a),
  listTags: () => mockListTags(),
  createContact: vi.fn(),
}));

vi.mock('$server/services/crm-scoring', () => ({
  matchingAutoTagIds: (row: { contact_id: string }, tags: { id: string }[]) =>
    tags.map((t) => t.id),
}));

import { GET } from './+server';

/** A page row shaped like the service's RankedContact (the golden element shape). */
const row = (id: string) => ({
  contact_id: id,
  display_name: `Contact ${id}`,
  owner_id: null,
  source: 'harvested',
  total_msgs: 3,
  inbound_msgs: 2,
  channels_used: 1,
  channels: ['whatsapp'],
  identities: [{ channel: 'whatsapp', externalId: '51999@wa', handle: null }],
  tag_ids: [],
  custom_fields: { telefono: '51999', dni: '12345678' },
  party_id: null,
  dni_verified: false,
  age: null,
  dob: null,
  sex: null,
  first_contact_at: null,
  last_contact_at: null,
  is_buyer: false,
  awaiting_reply: false,
  lead_origin: null,
  lead_campaign: null,
  last_days: 1,
  reciprocity: 0.5,
  r_score: 90,
  f_score: 50,
  m_score: 40,
  score: 65,
  stage: 'Engaged',
  funnel_stage: 'lead',
  finance: null,
});

const callGET = (search = '') =>
  GET({
    locals: {},
    url: new URL(`http://localhost/api/crm/contacts${search}`),
  } as unknown as Parameters<typeof GET>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCoreCtx.mockResolvedValue({ tenantId: 't1' });
  mockOwnerFilter.mockResolvedValue(undefined);
  mockShouldMask.mockResolvedValue(false);
  mockListTags.mockResolvedValue([]);
  mockRankContactsPage.mockResolvedValue({
    rows: [row('a'), row('b')],
    total: 42,
    hasMore: true,
    financeEnabled: true,
  });
});

describe('GET /api/crm/contacts (S3 page contract)', () => {
  it('401s without a core ctx', async () => {
    mockGetCoreCtx.mockResolvedValueOnce(null);
    await expect(callGET()).rejects.toMatchObject({ status: 401 });
  });

  it('returns { contacts, total } with the element shape passed through unchanged', async () => {
    const body = await (await callGET()).json();
    expect(Array.isArray(body.contacts)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.total).toBe(42);
    // `contacts` keeps its name and element shape (alert A2: additive only).
    expect(body.contacts[0]).toMatchObject(row('a'));
  });

  it('defaults limit to 100 and clamps limit to 500', async () => {
    await callGET();
    expect(mockRankContactsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 100, maxLimit: 500 }),
    );
    await callGET('?limit=9999&offset=200');
    expect(mockRankContactsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 500, maxLimit: 500, offset: 200 }),
    );
    await callGET('?limit=25');
    expect(mockRankContactsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 25 }),
    );
    await callGET('?limit=-5&offset=-10');
    expect(mockRankContactsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 1, offset: 0 }),
    );
  });

  it('lets continuation pages skip the exact filtered count', async () => {
    mockRankContactsPage.mockResolvedValueOnce({
      rows: [row('c')],
      total: null,
      hasMore: false,
      financeEnabled: true,
    });

    const body = await (await callGET('?offset=100&includeTotal=0')).json();

    expect(mockRankContactsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ offset: 100, includeTotal: false }),
    );
    expect(body).toMatchObject({ total: null, hasMore: false });
  });

  it('parses the S2 filters from the query string', async () => {
    await callGET(
      '?awaitingReply=true&reservedOnly=1&buyerOnly=true&funnelStage=customer&minIcp=10&maxIcp=90&sort=icp',
    );
    expect(mockRankContactsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        awaitingReply: true,
        reservedOnly: true,
        buyerOnly: true,
        funnelStage: 'customer',
        minIcp: 10,
        maxIcp: 90,
        sort: 'icp',
      }),
    );
    // absent boolean params stay undefined (not false — the SQL predicate is skipped)
    await callGET();
    expect(mockRankContactsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ awaitingReply: undefined, reservedOnly: undefined }),
    );
  });

  it('decorates ONLY the returned page with live auto-tag matches; finance already comes from SQL', async () => {
    mockListTags.mockResolvedValue([
      { id: 'tag-auto', kind: 'auto', rule: { op: 'gte' } },
      { id: 'tag-manual', kind: 'manual', rule: null },
    ]);
    mockRankContactsPage.mockResolvedValue({
      rows: [{ ...row('a'), finance: { revenue: 100 } }, row('b')],
      total: 42,
      hasMore: true,
      financeEnabled: true,
    });
    const body = await (await callGET()).json();
    expect(body.contacts[0].auto_tag_ids).toEqual(['tag-auto']);
    expect(body.contacts[0].finance).toEqual({ revenue: 100 });
    expect(body.contacts[1].finance).toBeNull();
    // pre-decoration fields untouched
    expect(body.contacts[0].contact_id).toBe('a');
  });

  it('?fields=id returns ids only — no PII in any element — capped at ROSTER_CAP', async () => {
    const body = await (await callGET('?fields=id&stage=lead&limit=10')).json();
    expect(body.total).toBe(42);
    for (const el of body.contacts) expect(Object.keys(el)).toEqual(['contact_id']);
    expect(mockRankContactsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 50_000, maxLimit: 50_000, offset: 0, stage: 'lead' }),
    );
    // the lean variant never runs the page decoration
    expect(mockListTags).not.toHaveBeenCalled();
  });

  it('passes the masking flag through to the service (RBAC unchanged)', async () => {
    mockShouldMask.mockResolvedValue(true);
    await callGET();
    expect(mockRankContactsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ maskSensitive: true }),
    );
  });
});
