import { describe, expect, it } from 'vitest';
import { assertResolvedLoopback, mergeQaEnvOverride } from './dev';

describe('mergeQaEnvOverride', () => {
  it('lets .env.qa values win over anything already in the base env (e.g. a developer .env.local)', () => {
    const base = {
      PUBLIC_SUPABASE_URL: 'https://faces-sculptors.supabase.co',
      SUPABASE_DB_URL: 'postgresql://prod-host/postgres',
      UNRELATED: 'kept',
    };
    const qaVars = {
      PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54421',
      SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
    };
    const merged = mergeQaEnvOverride(base, qaVars);
    expect(merged.PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54421');
    expect(merged.SUPABASE_DB_URL).toBe(qaVars.SUPABASE_DB_URL);
    expect(merged.UNRELATED).toBe('kept');
  });
});

describe('assertResolvedLoopback', () => {
  it('returns the hostname when the resolved value is loopback', () => {
    expect(
      assertResolvedLoopback('PUBLIC_SUPABASE_URL', {
        PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54421',
      }),
    ).toBe('127.0.0.1');
  });

  it('throws when the fake .env.local value survives (isolation proof)', () => {
    expect(() =>
      assertResolvedLoopback('PUBLIC_SUPABASE_URL', {
        PUBLIC_SUPABASE_URL: 'https://fake.invalid',
      }),
    ).toThrow(/NOT loopback/);
  });

  it('throws when the var is missing entirely', () => {
    expect(() => assertResolvedLoopback('PUBLIC_SUPABASE_URL', {})).toThrow(/missing/);
  });
});

import { BACKEND_ENV_KEYS, ignoreInheritedBackendEnv, redactUrl } from './backend';

describe('ignoreInheritedBackendEnv', () => {
  it('drops every backend key Bun may have auto-loaded from .env/.env.local and keeps the rest', () => {
    const env: NodeJS.ProcessEnv = {
      SUPABASE_DB_URL: 'postgresql://postgres:secret@aws-1.pooler.supabase.com:6543/postgres',
      PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sr-key',
      PATH: '/usr/bin',
    };
    const dropped = ignoreInheritedBackendEnv('t', env);
    expect(dropped.sort()).toEqual(
      ['PUBLIC_SUPABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY'].sort(),
    );
    for (const k of BACKEND_ENV_KEYS) expect(env[k]).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('redactUrl', () => {
  it('never echoes credentials', () => {
    const out = redactUrl('postgresql://postgres:secret@aws-1.pooler.supabase.com:6543/postgres');
    expect(out).not.toContain('secret');
    expect(out).toContain('aws-1.pooler.supabase.com:6543');
  });
});
