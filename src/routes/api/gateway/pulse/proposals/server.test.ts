import { describe, it, expect, vi } from 'vitest';
import { POST } from './+server';

function req(body: unknown) {
  return new Request('http://x/api/gateway/pulse/proposals', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/gateway/pulse/proposals', () => {
  // NOTE: these tests hand-build `locals.serverId`, so they cannot catch a
  // missing allowlist entry in isServerTokenPath (resolve-identity.ts) — that
  // function is a local const inside resolveIdentity(), not exported, so it
  // isn't unit-testable in isolation without restructuring resolve-identity.ts.
  // The real dependency: a gateway Bearer request only reaches this handler
  // with locals.serverId set if '/api/gateway/pulse/proposals' is listed in
  // isServerTokenPath. See the NOTE comment above the guard in +server.ts.
  it('401 without server token', async () => {
    await expect(POST({ locals: {}, request: req({}) } as any)).rejects.toMatchObject({ status: 401 });
  });
  it('400 without orgId', async () => {
    await expect(POST({ locals: { serverId: 's1' }, request: req({ proposals: [] }) } as any))
      .rejects.toMatchObject({ status: 400 });
  });
});
