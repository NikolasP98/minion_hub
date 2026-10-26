import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  env: { OPENROUTER_API_KEY: 'k' } as Record<string, string | undefined>,
  getCoreCtx: vi.fn(),
  requireOrgCapability: vi.fn(),
  getDoor: vi.fn(),
  draft: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/auth/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
}));
vi.mock('$server/services/doors.service', () => ({ getDoor: mocks.getDoor }));
vi.mock('$server/services/doors-faq-draft.service', () => ({
  draftFaqsFromConversations: mocks.draft,
}));

import { POST } from './+server';

const ID = '11111111-2222-4333-8444-555555555555';
const call = () =>
  Promise.resolve(POST({ locals: {}, params: { id: ID } } as never)).then(
    (r) => r,
    (e: { status: number }) => ({ status: e.status }) as Response,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.OPENROUTER_API_KEY = 'k';
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  mocks.requireOrgCapability.mockResolvedValue(null);
  mocks.getDoor.mockResolvedValue({ id: ID, kind: 'faq' });
  mocks.checkRateLimit.mockReturnValue(true);
  mocks.draft.mockResolvedValue({ drafts: [{ q: 'Q', a: 'A', count: 3 }] });
});

describe('POST /api/crm/doors/[id]/faq-draft', () => {
  it('returns drafts for an owner, limited per org (3 / 10 min)', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ drafts: [{ q: 'Q', a: 'A', count: 3 }] });
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith({}, 'crm', 'manage');
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('faq-draft:org-1', 3, 600_000);
  });

  it('403 without crm:manage, before any read or model call', async () => {
    mocks.requireOrgCapability.mockImplementation(async () => {
      throw error(403, 'crm: manage required');
    });
    expect((await call()).status).toBe(403);
    expect(mocks.getDoor).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });

  it('503 ai_not_configured without a model key, without spending the rate limit', async () => {
    mocks.env.OPENROUTER_API_KEY = '';
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_not_configured' });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });

  it('429 when the org exceeded the limit', async () => {
    mocks.checkRateLimit.mockReturnValue(false);
    expect((await call()).status).toBe(429);
    expect(mocks.draft).not.toHaveBeenCalled();
  });

  it('404 for a missing door or a door of another kind', async () => {
    mocks.getDoor.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    mocks.getDoor.mockResolvedValueOnce({ id: ID, kind: 'form' });
    expect((await call()).status).toBe(404);
  });

  it('502 on a model failure, logging no message content', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.draft.mockRejectedValue(new Error('provider echoed: mi cel es 987654321'));
    expect((await call()).status).toBe(502);
    expect(JSON.stringify(log.mock.calls)).not.toContain('987654321');
    log.mockRestore();
  });
});
