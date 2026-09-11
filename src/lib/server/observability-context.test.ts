import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UNKNOWN,
  releaseContext,
  requestIdentity,
  distinctIdFor,
  sanitizeEventProperties,
  sanitizeErrorProperties,
} from './observability-context';

const RELEASE_VARS = [
  'PUBLIC_VERCEL_ENV',
  'VERCEL_ENV',
  'NODE_ENV',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_DEPLOYMENT_ID',
  'VERCEL_REGION',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(RELEASE_VARS.map((k) => [k, process.env[k]]));
  for (const k of RELEASE_VARS) delete process.env[k];
});
afterEach(() => {
  for (const k of RELEASE_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

const identity = () => requestIdentity({ routeId: '/(app)/x', method: 'GET' });

describe('releaseContext', () => {
  it('keeps unknown attribution explicit instead of inventing a release', () => {
    expect(releaseContext()).toEqual({
      environment: UNKNOWN,
      release: UNKNOWN,
      deployment_id: UNKNOWN,
      region: UNKNOWN,
    });
  });

  it('accepts a validated commit sha and environment', () => {
    process.env.PUBLIC_VERCEL_ENV = 'production';
    process.env.VERCEL_GIT_COMMIT_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    process.env.VERCEL_DEPLOYMENT_ID = 'dpl_abc123';
    expect(releaseContext()).toMatchObject({
      environment: 'production',
      release: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      deployment_id: 'dpl_abc123',
    });
  });

  it('rejects a non-sha release and a free-text environment', () => {
    process.env.PUBLIC_VERCEL_ENV = 'prod-eu-1';
    process.env.VERCEL_GIT_COMMIT_SHA = 'v1.2.3-hotfix';
    expect(releaseContext()).toMatchObject({ environment: UNKNOWN, release: UNKNOWN });
  });

  it('never reads a package version as a release', () => {
    process.env.NODE_ENV = 'production';
    // npm_package_version is set by npm/bun for every script run.
    process.env.npm_package_version = '9.9.9';
    expect(releaseContext().release).toBe(UNKNOWN);
    delete process.env.npm_package_version;
  });
});

describe('requestIdentity', () => {
  it('carries the route TEMPLATE, never the resolved customer path', () => {
    const id = requestIdentity({ routeId: '/(app)/crm/customers/[id]', method: 'get' });
    expect(id.route).toBe('/(app)/crm/customers/[id]');
    expect(id.method).toBe('GET');
  });

  it('falls back to [unmatched] for an absent or hostile route id', () => {
    expect(requestIdentity({ routeId: null }).route).toBe('[unmatched]');
    expect(requestIdentity({ routeId: '/x?token=abc secret' }).route).toBe('[unmatched]');
    expect(requestIdentity({ method: 'BREW' }).method).toBe(UNKNOWN);
  });

  it('takes org and actor from server-resolved locals as opaque ids only', () => {
    const id = requestIdentity({
      routeId: '/(app)/x',
      method: 'POST',
      locals: {
        orgId: '3f1c2b8a-0000-4444-8888-aaaabbbbcccc',
        user: { id: 'usr_9', email: 'owner@example.com', displayName: 'Real Name' } as never,
      },
    });
    expect(id.org_id).toBe('3f1c2b8a-0000-4444-8888-aaaabbbbcccc');
    expect(id.actor_id).toBe('usr_9');
    expect(JSON.stringify(id)).not.toContain('owner@example.com');
    expect(JSON.stringify(id)).not.toContain('Real Name');
  });

  it('falls back to the tenant context id and tolerates missing locals', () => {
    expect(requestIdentity({ locals: { tenantCtx: { tenantId: 'org_7' } } }).org_id).toBe('org_7');
    expect(requestIdentity({}).org_id).toBeNull();
    expect(requestIdentity({}).actor_id).toBeNull();
  });

  it('never lets a header claim a tenant or an actor', () => {
    const id = requestIdentity({
      routeId: '/(app)/x',
      headers: headers({
        'x-org-id': 'org_attacker',
        cookie: 'sb-access-token=secret',
        authorization: 'Bearer sk-live-abcdefgh',
      }),
    });
    expect(id.org_id).toBeNull();
    expect(id.actor_id).toBeNull();
    expect(JSON.stringify(id)).not.toContain('org_attacker');
    expect(JSON.stringify(id)).not.toContain('sk-live');
  });

  it('accepts a valid traceparent and run id as correlation hints', () => {
    const id = requestIdentity({
      routeId: '/(app)/x',
      headers: headers({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        'x-request-id': 'req_123',
        'x-minion-run-id': 'run_abc',
      }),
    });
    expect(id.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(id.request_id).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(id.agent_run_id).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('rejects malformed, zeroed and oversized correlation hints', () => {
    const id = requestIdentity({
      headers: headers({
        traceparent: '00-' + '0'.repeat(32) + '-00f067aa0ba902b7-01',
        'x-request-id': 'x'.repeat(500),
        'x-minion-run-id': 'run abc; DROP TABLE runs',
      }),
    });
    expect(id.trace_id).toBe(UNKNOWN);
    expect(id.request_id).toBe(UNKNOWN);
    expect(id.agent_run_id).toBeNull();
  });

  it('never throws on a header bag that throws', () => {
    const hostile = {
      get() {
        throw new Error('boom');
      },
    };
    expect(() => requestIdentity({ routeId: '/x', headers: hostile })).not.toThrow();
    expect(requestIdentity({ routeId: '/x', headers: hostile }).trace_id).toBe(UNKNOWN);
  });
});

describe('distinctIdFor', () => {
  it('prefers the org, then the actor, then the server', () => {
    const base = identity();
    expect(distinctIdFor({ ...base, org_id: 'o1', actor_id: 'u1' })).toBe('org:o1');
    expect(distinctIdFor({ ...base, org_id: null, actor_id: 'u1' })).toBe('user:u1');
    expect(distinctIdFor(base)).toBe('server');
  });
});

describe('sanitizeEventProperties', () => {
  it('keeps the existing server_timing shape intact', () => {
    const props = {
      route: '/(app)/crm/customers/[id]',
      org_id: 'org_1',
      method: 'GET',
      duration_ms: 42.5,
      status: 200,
      sample_reason: 'slow',
      isolate_cold: false,
      cache_hits: 3,
      cache_lookup_ms: 0,
    };
    expect(sanitizeEventProperties(props)).toEqual(props);
  });

  it('drops sensitive keys whatever they hold', () => {
    const out = sanitizeEventProperties({
      access_token: 'abc',
      cookie: 'sb=1',
      user_email: 'a@b.com',
      sql_statement: 'select 1',
      request_body: 'x',
      error_message: 'x',
      stack_head: 'x',
      customer_name: 'x',
      duration_ms: 1,
    });
    expect(out).toEqual({ duration_ms: 1 });
  });

  it('drops values that look like credentials, addresses or statements', () => {
    const out = sanitizeEventProperties({
      note: 'contact owner@example.com about it',
      hint: 'Bearer sk-live-abcdefgh',
      jwt_ish: 'eyJhbGciOiJIUzI1NiJ9.aaa.bbb',
      db: 'SELECT card_number FROM customers WHERE id = 3',
      ok: 'plain-value',
    });
    expect(out).toEqual({});
  });

  it('drops non-scalars, oversized strings, bad keys and unbounded bags', () => {
    const out = sanitizeEventProperties({
      nested: { leaked: 'inner' },
      list: ['a'],
      fn: () => 'x',
      big: 'y'.repeat(300),
      'Weird-Key': 'v',
      __proto__: 'v',
      nan: Number.NaN,
      kept: 1,
    });
    expect(out).toEqual({});

    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitizeEventProperties(many)).length).toBeLessThanOrEqual(48);
  });

  it('tolerates null and non-object input', () => {
    expect(sanitizeEventProperties(null)).toEqual({});
    expect(sanitizeEventProperties(undefined)).toEqual({});
    expect(sanitizeEventProperties('nope' as never)).toEqual({});
  });
});

describe('sanitizeErrorProperties', () => {
  class DbError extends Error {
    code = '42703';
  }

  it('attaches identity and never ships the message', () => {
    const err = new DbError(
      'column "x" does not exist: SELECT * FROM crm_customers WHERE email = \'owner@example.com\' -- token sk-live-abcdefgh',
    );
    const props = sanitizeErrorProperties({ error: err, status: 500, identity: identity() });
    const wire = JSON.stringify(props);

    expect(props.error_type).toBe('DbError');
    expect(props.error_code).toBe('42703');
    expect(props.status).toBe(500);
    expect(props.route).toBe('/(app)/x');
    expect(props.error_digest).toMatch(/^[0-9a-f]{16}$/);
    expect(props.error_length).toBe(err.message.length);

    expect(wire).not.toContain('owner@example.com');
    expect(wire).not.toContain('sk-live');
    expect(wire).not.toContain('SELECT');
    expect(wire).not.toContain('crm_customers');
  });

  it('groups the same message and separates a different one', () => {
    const id = identity();
    const a = sanitizeErrorProperties({ error: new Error('same'), identity: id });
    const b = sanitizeErrorProperties({ error: new Error('same'), identity: id });
    const c = sanitizeErrorProperties({ error: new Error('other'), identity: id });
    expect(a.error_digest).toBe(b.error_digest);
    expect(a.error_digest).not.toBe(c.error_digest);
  });

  it('records a bounded cause chain as types only', () => {
    const leaf = new Error('secret cookie sb-access-token=abc');
    const mid = new TypeError('mid', { cause: leaf });
    const top = new Error('top', { cause: mid });
    const props = sanitizeErrorProperties({ error: top, status: 500, identity: identity() });
    expect(props.error_cause_chain).toBe('TypeError>Error');
    expect(JSON.stringify(props)).not.toContain('sb-access-token');
  });

  it('survives a hostile cause cycle and an oversized message', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b; // cycle
    const props = sanitizeErrorProperties({ error: a, status: 500, identity: identity() });
    expect(String(props.error_cause_chain).split('>').length).toBeLessThanOrEqual(4);

    const huge = sanitizeErrorProperties({
      error: new Error('z'.repeat(2_000_000)),
      identity: identity(),
    });
    expect(JSON.stringify(huge).length).toBeLessThan(2000);
    expect(huge.error_length).toBe(2_000_000);
  });

  it('survives the capture-path filter unchanged (captureServerEvent applies it)', () => {
    const props = sanitizeErrorProperties({
      error: new DbError('boom at SELECT * FROM x'),
      status: 500,
      identity: requestIdentity({
        routeId: '/(app)/crm/customers/[id]',
        method: 'POST',
        locals: { orgId: 'org_1', user: { id: 'usr_1' } },
      }),
    });
    // No identity or error field may be dropped by the generic property filter.
    expect(sanitizeEventProperties(props)).toEqual(props);
    expect(Object.keys(props)).toContain('org_id');
    expect(Object.keys(props)).toContain('error_length');
  });

  it('rejects a hostile error code and a non-Error throw', () => {
    const spoofed = Object.assign(new Error('x'), { code: 'Bearer sk-live-abcdefgh' });
    expect(sanitizeErrorProperties({ error: spoofed, identity: identity() }).error_code).toBeNull();

    const raw = sanitizeErrorProperties({
      error: 'raw string with owner@example.com',
      identity: identity(),
    });
    expect(raw.error_type).toBe('string');
    expect(JSON.stringify(raw)).not.toContain('owner@example.com');

    expect(sanitizeErrorProperties({ error: null, identity: identity() }).error_type).toBe('null');
    expect(sanitizeErrorProperties({ error: undefined, identity: identity() }).status).toBe(0);
  });
});

describe('untrusted correlation boundary', () => {
  it('never emits arbitrary raw request/run hints, including credential-shaped values', () => {
    for (const value of [
      'ghp_privateCredential123',
      'eyJhbGciOiJIUzI1NiJ9.aaa.bbb',
      'sk-privateabcdefgh',
      'req_123',
    ]) {
      const input = { headers: headers({ 'x-request-id': value, 'x-minion-run-id': value }) };
      const id = requestIdentity(input);
      expect(id.request_id).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(id.agent_run_id).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(id.agent_run_id).not.toBe(id.request_id);
      expect(id.request_id).toBe(requestIdentity(input).request_id);
      expect(JSON.stringify(id)).not.toContain(value);
    }
  });

  it('rejects a traceparent whose parent span is zero', () => {
    expect(
      requestIdentity({
        headers: headers({
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
        }),
      }).trace_id,
    ).toBe(UNKNOWN);
  });
});

describe('event field profiles', () => {
  it('rejects wrong metric types, negative counts and event-inappropriate fields', () => {
    expect(
      sanitizeEventProperties(
        {
          duration_ms: '1',
          status: 999,
          cache_hits: -1,
          cache_status: 'private-sentinel',
          sample_reason: 'other',
          isolate_cold: 1,
        },
        'server_timing',
      ),
    ).toEqual({});
    expect(
      sanitizeEventProperties(
        { duration_ms: 1, server_id: 'sha256:' + 'a'.repeat(64), error_digest: 'a'.repeat(16) },
        'server_added',
      ),
    ).toEqual({ server_id: 'sha256:' + 'a'.repeat(64) });
    expect(sanitizeEventProperties({ duration_ms: 1 }, 'unknown-event')).toEqual({});
  });

  it('does not enumerate arbitrary bags or read inherited/accessor values', () => {
    let touched = 0;
    const properties = Object.defineProperty(Object.create({ cache_hits: 9 }), 'duration_ms', {
      get() {
        touched++;
        throw new Error('private-sentinel');
      },
    });
    Object.defineProperty(properties, 'status', { value: 200 });
    const proxy = new Proxy(properties, {
      ownKeys() {
        throw new Error('must not enumerate');
      },
    });
    expect(sanitizeEventProperties(proxy, 'server_timing')).toEqual({ status: 200 });
    expect(touched).toBe(0);
  });

  it('keeps the complete actual performance producer contract', async () => {
    const { createServerTimingHandle } = await import('./server-timing');
    let captured: Record<string, unknown> | undefined;
    const handle = createServerTimingHandle({
      sampleRate: 1,
      nextOrdinal: () => 1,
      now: () => 20,
      wallClock: () => 30,
      instanceStartedAt: 10,
      capture: (event, properties) => {
        captured = properties;
        expect(sanitizeEventProperties(properties, event)).toEqual(properties);
      },
    });
    const event = {
      url: new URL('http://fixture.invalid/private-customer-sentinel'),
      route: { id: '/(app)/crm/customers/[id]' },
      locals: { orgId: 'org_1' },
      request: new Request('http://fixture.invalid/'),
    };
    await handle({
      event: event as unknown as Parameters<typeof handle>[0]['event'],
      resolve: async () => new Response('ok', { status: 200 }),
    });
    expect(captured?.route).toBe('/(app)/crm/customers/[id]');
    expect(captured).toHaveProperty('db_total_ms');
    expect(JSON.stringify(captured)).not.toContain('private-customer-sentinel');
  });
});
