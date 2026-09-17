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

import {
  BACKEND_ENV_KEYS,
  OUTBOUND_SERVICE_ENV_KEYS,
  ignoreInheritedBackendEnv,
  redactUrl,
} from './backend';

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

  it('also drops every outbound-service key (B2/Resend/Meta/GitHub/LLM/Sentry/SUNAT/gateway)', () => {
    const env: NodeJS.ProcessEnv = {
      RESEND_API_KEY: 'fake_should_not_leak',
      B2_APPLICATION_KEY: 'not-a-real-key-name', // not in the list — should survive untouched
      B2_APP_KEY: 'fake_should_not_leak',
      META_APP_SECRET: 'fake_should_not_leak',
      GITHUB_TOKEN: 'fake_should_not_leak',
      OPENROUTER_API_KEY: 'fake_should_not_leak',
      SENTRY_DSN: 'https://fake@sentry.example/1',
      MINION_GATEWAY_BROADCAST_URL: 'https://gateway.example',
      PATH: '/usr/bin',
    };
    const dropped = ignoreInheritedBackendEnv('t', env);
    expect(dropped).toEqual(
      expect.arrayContaining([
        'RESEND_API_KEY',
        'B2_APP_KEY',
        'META_APP_SECRET',
        'GITHUB_TOKEN',
        'OPENROUTER_API_KEY',
        'SENTRY_DSN',
        'MINION_GATEWAY_BROADCAST_URL',
      ]),
    );
    for (const k of OUTBOUND_SERVICE_ENV_KEYS) expect(env[k]).toBeUndefined();
    // A key that merely resembles a real name (typo/alias) is left alone —
    // this function drops an exact, documented list, not a fuzzy pattern.
    expect(env.B2_APPLICATION_KEY).toBe('not-a-real-key-name');
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
