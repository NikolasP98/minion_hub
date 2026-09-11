import { describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCoreDb: vi.fn(), resolvePrincipal: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: mocks.getCoreDb }));
vi.mock('$server/auth/assistant-principal', () => ({
  resolveAssistantPrincipal: mocks.resolvePrincipal,
}));

import { POST } from './+server';

describe('POST /api/gateway/query containment', () => {
  test('returns a stable disabled response without reading the body or initializing auth/data clients', async () => {
    const json = vi.fn(() => {
      throw new Error('Disabled route must not parse caller SQL');
    });
    const response = await POST({
      locals: {},
      url: new URL('https://hub.test/api/gateway/query'),
      request: { json },
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'ASSISTANT_SQL_DISABLED',
      error: 'Arbitrary SQL analytics is unavailable. Use a supported typed query.',
      retryable: false,
    });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.getCoreDb).not.toHaveBeenCalled();
    expect(mocks.resolvePrincipal).not.toHaveBeenCalled();
  });
});
