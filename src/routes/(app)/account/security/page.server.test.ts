import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ list: vi.fn(async () => [{ id: 'c1' }]) }));
vi.mock('$server/auth/password', () => ({ hasPasswordIdentity: async () => true }));
vi.mock('$server/mcp/oauth.service', () => ({ listConnections: m.list }));

import { load } from './+page.server';

describe('account security page load', () => {
  it("lists only the signed-in person's own MCP connections in the active organization, for any member", async () => {
    const data = (await load({
      locals: {
        user: { supabaseId: 'u1', id: 'u1', email: 'a@b.test', username: null, role: 'user' },
        tenantCtx: { tenantId: 'org-1' },
      },
      depends: () => {},
    } as never)) as { connections: unknown[] };
    expect(m.list).toHaveBeenCalledWith('org-1', 'u1', false);
    expect(data.connections).toEqual([{ id: 'c1' }]);
  });
});
