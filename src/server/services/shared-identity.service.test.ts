import { describe, it, expect, vi, beforeEach } from 'vitest';

// shared-identity.service talks to Supabase via `supabaseAdmin()` query chains
// plus two credential getters imported directly. Mock all three the same way
// sibling service tests do: a chain-recording Proxy for supabaseAdmin (see
// user.service.test.ts), plain vi.fn() stubs for the credential getters (see
// identity.service.test.ts).

const getGoogleCredential = vi.fn();
vi.mock('./identity.service', () => ({
  getGoogleCredential: (...args: unknown[]) => getGoogleCredential(...args),
}));

const getGoogleCredentialFromSupabase = vi.fn();
vi.mock('./supabase-credential', () => ({
  getGoogleCredentialFromSupabase: (...args: unknown[]) => getGoogleCredentialFromSupabase(...args),
}));

// Table fixtures + a tiny filter engine that actually applies the recorded
// .eq()/.in() chain (like Postgres would), so a test fails if the service
// stops passing an org filter rather than because the mock special-cased it.
type Row = Record<string, unknown>;
let fixtures: Record<string, Row[]> = {};

function applyChain(rows: Row[], methods: unknown[][]): Row[] {
  let result = rows;
  for (const [op, ...args] of methods) {
    if (op === 'eq') {
      const [col, val] = args as [string, unknown];
      result = result.filter((r) => r[col] === val);
    } else if (op === 'in') {
      const [col, vals] = args as [string, unknown[]];
      const set = new Set(vals);
      result = result.filter((r) => set.has(r[col]));
    }
  }
  return result;
}

function makeAdmin() {
  function from(table: string) {
    const methods: unknown[][] = [];
    const handler: ProxyHandler<object> = {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve({ data: applyChain(fixtures[table] ?? [], methods), error: null }).then(
              res,
              rej,
            );
        }
        if (prop === 'maybeSingle') {
          return () => {
            const rows = applyChain(fixtures[table] ?? [], methods);
            return Promise.resolve({ data: rows[0] ?? null, error: null });
          };
        }
        return (...args: unknown[]) => {
          methods.push([prop, ...args]);
          return proxy;
        };
      },
    };
    const proxy: Record<string, unknown> = new Proxy({}, handler);
    return proxy;
  }
  return { from };
}

vi.mock('$server/supabase', () => ({ supabaseAdmin: () => makeAdmin() }));

import { listAvailableSharedIdentities, resolveFeedGoogleCredentials } from './shared-identity.service';

const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SUB = '11111111-0000-0000-0000-000000000001';
const OWNER_B = '22222222-0000-0000-0000-000000000002';
const OWNER_A = '33333333-0000-0000-0000-000000000003';
const STRANGER = '99999999-0000-0000-0000-000000000009';

beforeEach(() => {
  vi.clearAllMocks();
  // Subscriber belongs to BOTH orgs. Identity id-a is shared/subscribed only
  // in orgA; id-b only in orgB. Any test scoping to orgB must never surface
  // id-a — that's the cross-tenant leak this fix closes.
  fixtures = {
    organization_members: [
      { profile_id: SUB, organization_id: ORG_B },
      { profile_id: SUB, organization_id: ORG_A },
      { profile_id: OWNER_B, organization_id: ORG_B },
      { profile_id: OWNER_A, organization_id: ORG_A },
    ],
    user_identities: [
      {
        id: 'id-b',
        user_id: OWNER_B,
        provider: 'google',
        external_id: 'ownerb@x.com',
        display_name: 'B Identity',
        shareable: true,
      },
      {
        id: 'id-a',
        user_id: OWNER_A,
        provider: 'google',
        external_id: 'ownera@x.com',
        display_name: 'A Identity',
        shareable: true,
      },
    ],
    profiles: [
      { id: OWNER_B, display_name: 'Owner B' },
      { id: OWNER_A, display_name: 'Owner A' },
    ],
    identity_subscriptions: [
      { identity_id: 'id-b', subscriber_profile_id: SUB, organization_id: ORG_B },
      { identity_id: 'id-a', subscriber_profile_id: SUB, organization_id: ORG_A },
    ],
  };
});

describe('listAvailableSharedIdentities', () => {
  it('does not return identities shared only in a different org (orgA) when scoped to orgB', async () => {
    const available = await listAvailableSharedIdentities(SUB, ORG_B);
    expect(available.map((a) => a.identityId)).toEqual(['id-b']);
  });

  it('returns [] when the subscriber is not a member of the given org', async () => {
    const available = await listAvailableSharedIdentities(STRANGER, ORG_B);
    expect(available).toEqual([]);
  });
});

describe('resolveFeedGoogleCredentials', () => {
  it('returns the own identity plus only the shared identity subscribed in orgId, never a different org', async () => {
    getGoogleCredential.mockResolvedValue({ email: 'me@x.com', adc: { type: 'authorized_user' } });
    getGoogleCredentialFromSupabase.mockImplementation(async (ownerId: string) =>
      ownerId === OWNER_B ? { email: 'ownerb@x.com', adc: { type: 'authorized_user' } } : null,
    );

    const result = await resolveFeedGoogleCredentials({ db: {} as never, tenantId: ORG_B }, SUB, ORG_B);

    expect(result).toEqual([
      { email: 'me@x.com', adc: { type: 'authorized_user' }, shared: false },
      { email: 'ownerb@x.com', adc: { type: 'authorized_user' }, shared: true, ownerName: 'Owner B' },
    ]);
    expect(getGoogleCredentialFromSupabase).not.toHaveBeenCalledWith(OWNER_A);
  });

  it('fails closed: with no orgId, returns ONLY the own identity, no shared lookups at all', async () => {
    getGoogleCredential.mockResolvedValue({ email: 'me@x.com', adc: { type: 'authorized_user' } });

    const result = await resolveFeedGoogleCredentials({ db: {} as never, tenantId: ORG_B }, SUB);

    expect(result).toEqual([{ email: 'me@x.com', adc: { type: 'authorized_user' }, shared: false }]);
    expect(getGoogleCredentialFromSupabase).not.toHaveBeenCalled();
  });
});
