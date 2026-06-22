import { describe, it, expect, vi } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: 'done', steps: [] })),
  tool: (def: unknown) => def,
  stepCountIs: () => ({}),
}));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => () => ({}) }));
vi.mock('$env/dynamic/private', () => ({ env: { OPENROUTER_API_KEY: 'k' } }));

const flowRow = { id: 'f1', userId: 'owner1', tenantId: 'org1', nodes: '[]', edges: '[]' };
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_s: unknown, fn: (t: unknown) => unknown) =>
    fn({ select: () => ({ from: () => ({ where: () => Promise.resolve([flowRow]) }) }) }),
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$server/auth/core-ctx', () => ({
  requireCoreCtx: async () => ({ tenantId: 'org1', profileId: 'p1' }),
}));

import { POST } from './+server';

const call = (body: object, user: { id: string; role: string }) =>
  POST({ request: { json: async () => body }, params: { id: 'f1' }, locals: { user } } as never);

describe('copilot endpoint gating', () => {
  it('403 for non-admin non-owner', async () => {
    await expect(call({ messages: [] }, { id: 'other', role: 'member' })).rejects.toMatchObject({ status: 403 });
  });
  it('allows the flow owner', async () => {
    const res = await call({ messages: [{ role: 'user', content: 'hi' }] }, { id: 'owner1', role: 'member' });
    expect(res.status).toBeLessThan(400);
  });
  it('allows an admin', async () => {
    const res = await call({ messages: [{ role: 'user', content: 'hi' }] }, { id: 'x', role: 'admin' });
    expect(res.status).toBeLessThan(400);
  });
});
