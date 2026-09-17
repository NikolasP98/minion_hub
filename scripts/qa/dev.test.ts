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
