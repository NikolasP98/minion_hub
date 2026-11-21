import { beforeEach, describe, expect, it, vi } from 'vitest';

// P4: a cookie on the same request can carry role simulation or admitted capabilities; neither
// may reach a tool run for a connection credential.
const m = vi.hoisted(() => ({ seen: [] as unknown[], can: vi.fn(async () => true) }));
vi.mock('$server/mcp/caller', () => ({
  resolveMcpCaller: async () => ({
    kind: 'user',
    ctx: { db: {}, tenantId: 'org-1', profileId: 'u1' },
    locals: { user: { supabaseId: 'u1' }, tenantCtx: { tenantId: 'org-1' } },
    connectionId: 'c1',
    sandboxBlocked: false,
  }),
}));
vi.mock('$server/services/rbac.service', () => ({ hasOrgCapability: m.can }));
vi.mock('$server/mcp/sandbox-tools', () => ({
  sandboxFailure: () => null,
  sandboxToolsFor: () => [],
}));
vi.mock('$server/mcp/protocol', async () => {
  const fx = await import('$server/auth/effective-authority');
  return {
    handleMcp: async () => {
      m.seen.push({
        simulating: fx.isSimulating(),
        capabilities: fx.currentRequestCapabilities('org-1', 'u1'),
        actor: fx.simulationAuditContext('org-1', 'u1'),
      });
      return { status: 200, body: { ok: true } };
    },
  };
});

import {
  runWithEffectiveAuthority,
  runWithRequestCapabilities,
} from '$server/auth/effective-authority';
import { POST } from './+server';

beforeEach(() => (m.seen.length = 0));

describe('POST /api/mcp isolation from cookie identity', () => {
  it('a simulated role and admitted capabilities from the cookie path do not apply', async () => {
    const simulated = {
      profileId: 'u1',
      orgId: 'org-1',
      roleKey: 'viewer',
      generation: 'g',
      rank: 1,
      invalid: false,
      capabilities: { can: () => false },
    } as never;
    const admitted = {
      orgId: 'org-1',
      profileId: 'u1',
      capabilities: { can: () => true },
    } as never;
    const res = await runWithEffectiveAuthority(simulated, () =>
      runWithRequestCapabilities(admitted, () =>
        POST({
          request: new Request('https://hub.test/api/mcp', {
            method: 'POST',
            headers: { authorization: 'Bearer mcp_at_x', cookie: 'sb-token=abc' },
            body: '{}',
          }),
        } as never),
      ),
    );
    expect(res.status).toBe(200);
    expect(m.seen).toEqual([{ simulating: false, capabilities: undefined, actor: undefined }]);
  });
});
