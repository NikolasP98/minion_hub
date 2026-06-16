/**
 * Integration test: workforce proxy + hub-identity middleware contract.
 *
 * Path A implementation — the middleware logic is inlined as a local fixture
 * because `express` is not installed in minion_hub's node_modules (the
 * cross-repo import from paperclip-minion/server/src/middleware/hub-identity.ts
 * would fail the hub tsconfig resolution).
 *
 * The fixture is a verbatim copy of the relevant runtime logic from:
 *   paperclip-minion/server/src/middleware/hub-identity.ts
 *
 * HTTP utility: mock req/res objects (same pattern as the upstream test in
 *   paperclip-minion/server/src/middleware/hub-identity.test.ts).
 * No actual HTTP server is spawned — no Postgres/DB required.
 *
 * Security guarantees covered:
 *   1. Rejects requests without X-Hub-Identity → 401
 *   2. Accepts valid JWT and hydrates req.user + companyId → 200 (next called)
 *   3. Rejects path-companyId mismatch → 403 (scoping enforcement at boundary)
 */

import { describe, it, expect, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { mintIdentity } from '@minion-stack/workforce-client/identity-jwt';

// ---------------------------------------------------------------------------
// Pinned fixture: hub-identity middleware contract
// (mirrors paperclip-minion/server/src/middleware/hub-identity.ts)
// If the upstream changes the auth logic, update this fixture to match.
// ---------------------------------------------------------------------------

const SECRET = 'a'.repeat(43) + '=';

type MockReq = {
  headers: Record<string, string | string[] | undefined>;
  path: string;
  user?: { id: string; email: string | null; name: string | null };
  companyId?: string | null;
};

type MockRes = {
  _status: number;
  _body: unknown;
  status(code: number): MockRes;
  json(body: unknown): void;
};

function makeMockRes(): MockRes {
  const res: MockRes = {
    _status: 200,
    _body: undefined,
    status(code) {
      res._status = code;
      return res;
    },
    json(body) {
      res._body = body;
    },
  };
  return res;
}

/**
 * Inline implementation of hubIdentityMiddleware.
 * Validates X-Hub-Identity JWT and enforces company path scoping.
 */
async function runHubIdentityMiddleware(
  req: MockReq,
  res: MockRes,
  next: () => void,
): Promise<void> {
  const key = new Uint8Array(Buffer.from(SECRET, 'base64'));
  const header = req.headers['x-hub-identity'];
  const token = Array.isArray(header) ? header[0] : header;

  if (!token) {
    res.status(401).json({ error: 'missing_hub_identity' });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    const userId = String(payload.userId ?? '');
    if (!userId) {
      res.status(401).json({ error: 'invalid_hub_identity' });
      return;
    }

    req.user = {
      id: userId,
      email: (payload.email as string | null) ?? null,
      name: (payload.name as string | null) ?? null,
    };
    const jwtCompanyId = (payload.companyId as string | null) ?? null;
    req.companyId = jwtCompanyId;

    // Company path-scope enforcement (mirrors Correction A in upstream).
    const m = req.path.match(/^\/companies\/([^/]+)/);
    if (m) {
      const pathCompanyId = m[1]!;
      if (jwtCompanyId !== pathCompanyId) {
        res.status(403).json({ error: 'company_scope_mismatch' });
        return;
      }
    }

    next();
  } catch {
    res.status(401).json({ error: 'invalid_hub_identity' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mintToken(claims: {
  userId: string;
  email: string | null;
  name: string | null;
  companyId: string | null;
}): Promise<string> {
  return mintIdentity({ secret: SECRET, claims, ttlSeconds: 60 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hub-identity middleware contract', () => {
  it('rejects requests without X-Hub-Identity → 401', async () => {
    const req: MockReq = { headers: {}, path: '/health' };
    const res = makeMockRes();
    const next = vi.fn();

    await runHubIdentityMiddleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'missing_hub_identity' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid (garbage) token → 401', async () => {
    const req: MockReq = {
      headers: { 'x-hub-identity': 'not.a.jwt' },
      path: '/health',
    };
    const res = makeMockRes();
    const next = vi.fn();

    await runHubIdentityMiddleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'invalid_hub_identity' });
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid JWT and hydrates req.user + req.companyId → next()', async () => {
    const token = await mintToken({
      userId: 'u-hub-001',
      email: 'admin@facesculptors.net',
      name: 'Hub Admin',
      companyId: 'company-abc',
    });

    const req: MockReq = {
      headers: { 'x-hub-identity': token },
      path: '/health',
    };
    const res = makeMockRes();
    const next = vi.fn();

    await runHubIdentityMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual({
      id: 'u-hub-001',
      email: 'admin@facesculptors.net',
      name: 'Hub Admin',
    });
    expect(req.companyId).toBe('company-abc');
    expect(res._status).toBe(200); // unchanged — no error response sent
  });

  it('enforces company path-scope: rejects mismatch → 403', async () => {
    // Token has companyId=c1 but request targets /companies/c2 — must be blocked.
    const token = await mintToken({
      userId: 'u-hub-002',
      email: null,
      name: null,
      companyId: 'company-c1',
    });

    const req: MockReq = {
      headers: { 'x-hub-identity': token },
      path: '/companies/company-c2/dashboard',
    };
    const res = makeMockRes();
    const next = vi.fn();

    await runHubIdentityMiddleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'company_scope_mismatch' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows access when JWT companyId matches path companyId → next()', async () => {
    const token = await mintToken({
      userId: 'u-hub-003',
      email: null,
      name: null,
      companyId: 'company-xyz',
    });

    const req: MockReq = {
      headers: { 'x-hub-identity': token },
      path: '/companies/company-xyz/dashboard',
    };
    const res = makeMockRes();
    const next = vi.fn();

    await runHubIdentityMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.companyId).toBe('company-xyz');
  });
});
