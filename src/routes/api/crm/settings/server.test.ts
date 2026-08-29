import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  getCoreCtx: vi.fn(),
  resolveDepositRule: vi.fn(),
  writeDepositRule: vi.fn(),
}));

vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => mocks.requireOrgCapability(...args),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (...args: unknown[]) => mocks.getCoreCtx(...args),
}));
vi.mock('$server/services/crm-settings.service', () => ({
  resolveDepositRule: (...args: unknown[]) => mocks.resolveDepositRule(...args),
  writeDepositRule: (...args: unknown[]) => mocks.writeDepositRule(...args),
}));

import { GET, PUT } from './+server';

function event(body?: Record<string, unknown>) {
  return {
    locals: {
      user: { id: 'user-1', role: 'user', supabaseId: 'profile-1' },
      tenantCtx: { tenantId: 'org-1' },
    },
    request: body
      ? new Request('http://localhost/api/crm/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      : undefined,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
});

describe('GET /api/crm/settings', () => {
  it('requires crm:view before resolving the deposit rule', async () => {
    mocks.resolveDepositRule.mockResolvedValue({ keywords: [] });

    const response = await GET(event());

    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(expect.anything(), 'crm', 'view');
    expect(response.status).toBe(200);
  });

  it('rejects a role without crm:view before reading org settings', async () => {
    mocks.requireOrgCapability.mockRejectedValueOnce({ status: 403 });

    await expect(GET(event())).rejects.toMatchObject({ status: 403 });
    expect(mocks.getCoreCtx).not.toHaveBeenCalled();
    expect(mocks.resolveDepositRule).not.toHaveBeenCalled();
  });
});

describe('PUT /api/crm/settings', () => {
  it('writes the deposit rule after the centrally-gated request body validates', async () => {
    mocks.writeDepositRule.mockResolvedValue({ deposit: { keywords: ['adelanto'] } });

    const response = await PUT(event({ deposit: { keywords: ['adelanto'] } }));

    expect(response.status).toBe(200);
    expect(mocks.writeDepositRule).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      { keywords: ['adelanto'] },
    );
  });

  it('answers under the same `deposit` key the request uses, carrying the ⚠️ A3 staleness disclosure', async () => {
    mocks.writeDepositRule.mockResolvedValue({
      rule: { keywords: ['adelanto'], label: 'Reserved a consult' },
      staleDerived: true,
      staleDerivedCount: 12,
    });

    const response = await PUT(event({ deposit: { keywords: ['adelanto'] } }));

    // Symmetric with GET: `deposit` in, `deposit` out — the write never leaks
    // the service's internal `rule` name to the wire.
    expect(await response.json()).toEqual({
      deposit: { keywords: ['adelanto'], label: 'Reserved a consult' },
      staleDerived: true,
      staleDerivedCount: 12,
    });
  });

  // S3 DoD: every invalid body is a 400 AND the row is unchanged — which, at
  // this boundary, means writeDepositRule is never reached at all. Asserting
  // "not called" is the route-level proof of "row unchanged"; the persisted
  // half is proven against real PostgreSQL in crm-settings.sql.integration.test.ts.
  const rejected: Array<[string, Record<string, unknown>]> = [
    ['a keyword over the 40-char cap', { deposit: { keywords: ['x'.repeat(80)] } }],
    [
      '21 keywords (over the cap — rejected, never silently truncated)',
      { deposit: { keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) } },
    ],
    ['an unknown key inside deposit', { deposit: { keywords: ['ok'], surprise: 1 } }],
    [
      'a client-supplied updatedAt (server-stamped only)',
      { deposit: { keywords: ['ok'], updatedAt: '2020-01-01T00:00:00.000Z' } },
    ],
    ['a label over the 40-char cap', { deposit: { keywords: ['ok'], label: 'y'.repeat(41) } }],
    ['keywords that is not an array', { deposit: { keywords: 'reserva' } }],
    ['a blank keyword', { deposit: { keywords: [''] } }],
    ['no deposit key at all', { accounts: ['a1'] }],
  ];

  for (const [label, body] of rejected) {
    it(`rejects ${label} with 400 and never writes`, async () => {
      await expect(PUT(event(body))).rejects.toMatchObject({ status: 400 });
      expect(mocks.writeDepositRule).not.toHaveBeenCalled();
    });
  }

  it('401s when no tenant context resolves, before touching the settings row', async () => {
    mocks.getCoreCtx.mockResolvedValue(null);

    await expect(PUT(event({ deposit: { keywords: ['ok'] } }))).rejects.toMatchObject({
      status: 401,
    });
    expect(mocks.writeDepositRule).not.toHaveBeenCalled();
  });
});

// S3 DoD: "unauthenticated / wrong-org PUT → rejected by the existing write
// gate (assert, don't assume)".
//
// The handler-side half is asserted above (no resolvable ctx → 401, and the
// `/api/crm` → `crm:edit` mapping is pinned in rbac.service.test.ts). The half
// that is NOT expressible at the handler is the central one: an unauthenticated
// `/api/crm/*` request must never reach this module at all, because
// `finishApp` (hooks.server.ts) only lets a no-tenantCtx request fall through
// to the first-tenant fallback for paths in `API_UNAUTH_FALLBACK_PATHS`.
//
// That list is a plain local const inside a hook module whose import graph
// (Sentry, PostHog, $app/environment, supabase, the cache data plane) cannot be
// stood up in a unit test, so this reads the source. It is a guard, not a
// behavioral test, and it earns its place for one reason: adding `/api/crm` to
// that array is a one-line, review-invisible edit that would hand this org-wide
// config write to whatever org happens to be first in the `organizations`
// table — the same class of silent ungating the rbac.service.test.ts pin
// covers from the other direction.
describe('the central unauthenticated-API gate still excludes /api/crm', () => {
  it('does not list /api/crm (or an ancestor of it) in API_UNAUTH_FALLBACK_PATHS', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const hooksPath = fileURLToPath(new URL('../../../../hooks.server.ts', import.meta.url));
    const source = readFileSync(hooksPath, 'utf-8');

    const literal = /const API_UNAUTH_FALLBACK_PATHS = \[([\s\S]*?)\];/.exec(source);
    // If this ever fails, the gate was renamed or restructured — re-derive the
    // assertion against whatever replaced it rather than deleting this test.
    expect(
      literal,
      'API_UNAUTH_FALLBACK_PATHS literal not found in hooks.server.ts',
    ).not.toBeNull();

    const paths = [...literal![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toContain('/api/servers'); // sanity: we parsed the real list

    // `finishApp` matches each entry as an exact path AND as a `${entry}/`
    // prefix, so any ancestor of /api/crm/settings would open the write too.
    const opensCrm = paths.filter(
      (p) => '/api/crm/settings' === p || '/api/crm/settings'.startsWith(`${p}/`),
    );
    expect(
      opensCrm,
      'an unauthenticated /api/crm/settings write would fall through to the first-tenant fallback',
    ).toEqual([]);
  });
});
