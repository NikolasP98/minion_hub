import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression: the preview id is a RUNNER-GLOBAL handle. Stopping one must prove
 * the preview belongs to the calling project's repo, or any member of any org
 * can stop another org's dev server by guessing an id.
 */
const getProject = vi.fn();
const githubRepoOf = vi.fn();
const stopPreview = vi.fn(async () => ({ ok: true as const, data: undefined }));
const previewsForRepo = vi.fn();
const startPreview = vi.fn();
const requireOrgCapability = vi.fn(async () => {});

vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ tenantId: 'org1', profileId: 'p1' }),
}));
vi.mock('$server/api/validate', () => ({
  parseBody: async (request: Request) => await request.json(),
}));
vi.mock('$server/services/projects.service', () => ({ getProject, githubRepoOf }));
vi.mock('$server/services/preview-runner.service', () => ({
  startPreview,
  stopPreview,
  previewsForRepo,
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));

const PROJECT = { id: 'proj1', name: 'p', leadPartyId: null };
const REF = { owner: 'NikolasP98', repo: 'minion_hub' };

async function callDelete(previewId: string) {
  const { DELETE } = await import('./+server');
  return DELETE({
    locals: {},
    params: { id: 'proj1' },
    request: new Request('http://x', { method: 'DELETE', body: JSON.stringify({ previewId }) }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(PROJECT);
  githubRepoOf.mockReturnValue(REF);
});

describe('DELETE /api/projects/:id/preview', () => {
  it('stops a preview that belongs to the project repo', async () => {
    previewsForRepo.mockResolvedValue({
      previews: [{ id: 'mine-1', repo: 'NikolasP98/minion_hub' }],
      available: true,
      reason: null,
    });
    const res = await callDelete('mine-1');
    expect(res.status).toBe(200);
    expect(stopPreview).toHaveBeenCalledWith('mine-1');
  });

  it('404s a preview id from another repo, and never calls the runner', async () => {
    previewsForRepo.mockResolvedValue({
      previews: [{ id: 'mine-1', repo: 'NikolasP98/minion_hub' }],
      available: true,
      reason: null,
    });
    await expect(callDelete('someone-elses-preview')).rejects.toMatchObject({ status: 404 });
    expect(stopPreview).not.toHaveBeenCalled();
  });

  it('refuses when the project has no linked repo', async () => {
    githubRepoOf.mockReturnValue(null);
    await expect(callDelete('any')).rejects.toMatchObject({ status: 409 });
    expect(stopPreview).not.toHaveBeenCalled();
  });

  it('does not fall through to stopping when ownership cannot be established', async () => {
    previewsForRepo.mockResolvedValue({ previews: [], available: false, reason: 'unreachable' });
    await expect(callDelete('mine-1')).rejects.toMatchObject({ status: 502 });
    expect(stopPreview).not.toHaveBeenCalled();
  });
});
