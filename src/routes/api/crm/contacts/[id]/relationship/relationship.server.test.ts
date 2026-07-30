import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCoreCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (locals: unknown) => mockGetCoreCtx(locals),
}));

const mockOwnerFilter = vi.fn<(locals: unknown, module: unknown) => Promise<string | undefined>>();
const mockShouldMaskSensitive = vi.fn<(locals: unknown, module: unknown) => Promise<boolean>>();
vi.mock('$server/services/rbac.service', () => ({
  ownerFilter: (locals: unknown, module: unknown) => mockOwnerFilter(locals, module),
  shouldMaskSensitive: (locals: unknown, module: unknown) => mockShouldMaskSensitive(locals, module),
}));

const mockSetUserRelationship = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const mockResumeAiSuggestions = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('$server/services/crm-relationship.service', () => ({
  setUserRelationship: (...a: unknown[]) => mockSetUserRelationship(...a),
  resumeAiSuggestions: (...a: unknown[]) => mockResumeAiSuggestions(...a),
}));

function putRequest(body: unknown): Request {
  return new Request('http://localhost/api/crm/contacts/c1/relationship', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Unscoped, unmasked by default — individual tests override for the
  // owner-scope/masked-principal cases (spec F2).
  mockOwnerFilter.mockResolvedValue(undefined);
  mockShouldMaskSensitive.mockResolvedValue(false);
});

describe('PUT /api/crm/contacts/[id]/relationship', () => {
  it('401s with no core ctx', async () => {
    mockGetCoreCtx.mockResolvedValue(null);
    const { PUT } = await import('./+server');
    await expect(
      PUT({
        locals: {},
        params: { id: 'c1' },
        request: putRequest({ label: 'amiga', category: 'friend' }),
      } as Parameters<typeof PUT>[0]),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('403s a field-level masked principal — relationship data is PII-adjacent (spec R6)', async () => {
    mockGetCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
    mockShouldMaskSensitive.mockResolvedValue(true);
    const { PUT } = await import('./+server');
    await expect(
      PUT({
        locals: {},
        params: { id: 'c1' },
        request: putRequest({ label: 'amiga', category: 'friend' }),
      } as Parameters<typeof PUT>[0]),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockSetUserRelationship).not.toHaveBeenCalled();
  });

  it('400s on an out-of-enum category', async () => {
    mockGetCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
    const { PUT } = await import('./+server');
    await expect(
      PUT({
        locals: {},
        params: { id: 'c1' },
        request: putRequest({ label: 'amiga', category: 'partner' }),
      } as Parameters<typeof PUT>[0]),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockSetUserRelationship).not.toHaveBeenCalled();
  });

  it('sets the user relationship (label may be null to clear), threading ownerId through', async () => {
    mockGetCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
    mockOwnerFilter.mockResolvedValue('profile-1');
    mockSetUserRelationship.mockResolvedValue({ applied: true });

    const { PUT } = await import('./+server');
    const response = await PUT({
      locals: {},
      params: { id: 'c1' },
      request: putRequest({ label: null, category: 'unknown' }),
    } as Parameters<typeof PUT>[0]);

    expect(response.status).toBe(200);
    expect(mockSetUserRelationship).toHaveBeenCalledWith(
      { db: {}, tenantId: 'org-1' },
      'c1',
      { label: null, category: 'unknown' },
      'profile-1',
    );
  });

  it('404s (no existence leak) when the service reports 0 rows matched — not found or not owned', async () => {
    mockGetCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
    mockOwnerFilter.mockResolvedValue('profile-1');
    mockSetUserRelationship.mockResolvedValue({ applied: false });

    const { PUT } = await import('./+server');
    await expect(
      PUT({
        locals: {},
        params: { id: 'c1' },
        request: putRequest({ label: 'amiga', category: 'friend' }),
      } as Parameters<typeof PUT>[0]),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('DELETE /api/crm/contacts/[id]/relationship', () => {
  it('401s with no core ctx', async () => {
    mockGetCoreCtx.mockResolvedValue(null);
    const { DELETE } = await import('./+server');
    await expect(
      DELETE({ locals: {}, params: { id: 'c1' } } as Parameters<typeof DELETE>[0]),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('403s a field-level masked principal', async () => {
    mockGetCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
    mockShouldMaskSensitive.mockResolvedValue(true);
    const { DELETE } = await import('./+server');
    await expect(
      DELETE({ locals: {}, params: { id: 'c1' } } as Parameters<typeof DELETE>[0]),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockResumeAiSuggestions).not.toHaveBeenCalled();
  });

  it('resumes AI suggestions (clears the pin), threading ownerId through', async () => {
    mockGetCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
    mockOwnerFilter.mockResolvedValue('profile-1');
    mockResumeAiSuggestions.mockResolvedValue({ applied: true });

    const { DELETE } = await import('./+server');
    const response = await DELETE({
      locals: {},
      params: { id: 'c1' },
    } as Parameters<typeof DELETE>[0]);

    expect(response.status).toBe(200);
    expect(mockResumeAiSuggestions).toHaveBeenCalledWith({ db: {}, tenantId: 'org-1' }, 'c1', 'profile-1');
  });

  it('404s (no existence leak) when the service reports 0 rows matched', async () => {
    mockGetCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
    mockResumeAiSuggestions.mockResolvedValue({ applied: false });

    const { DELETE } = await import('./+server');
    await expect(
      DELETE({ locals: {}, params: { id: 'c1' } } as Parameters<typeof DELETE>[0]),
    ).rejects.toMatchObject({ status: 404 });
  });
});
