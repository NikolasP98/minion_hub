import { describe, expect, it } from 'vitest';
import { isDevBackend, requireDevBackend } from './dev-backend';

describe('isDevBackend', () => {
  it('true when both Supabase URLs are loopback (127.0.0.1)', () => {
    expect(
      isDevBackend({
        PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54421',
        SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('true for localhost and ::1 too', () => {
    expect(
      isDevBackend({
        PUBLIC_SUPABASE_URL: 'http://localhost:54421',
        SUPABASE_DB_URL: 'postgresql://postgres:postgres@[::1]:54422/postgres',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('false when both are missing', () => {
    expect(isDevBackend({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('false when only PUBLIC_SUPABASE_URL is loopback (SUPABASE_DB_URL missing)', () => {
    expect(
      isDevBackend({ PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54421' } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('false when only SUPABASE_DB_URL is loopback (PUBLIC_SUPABASE_URL missing)', () => {
    expect(
      isDevBackend({
        SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('false when one host is loopback and the other is hosted', () => {
    expect(
      isDevBackend({
        PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54421',
        SUPABASE_DB_URL: 'postgresql://postgres:pw@db.example.supabase.co:5432/postgres',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('false when both are hosted (production)', () => {
    expect(
      isDevBackend({
        PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_DB_URL: 'postgresql://postgres:pw@db.example.supabase.co:5432/postgres',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('false on an unparsable URL', () => {
    expect(
      isDevBackend({
        PUBLIC_SUPABASE_URL: 'not-a-url',
        SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe('requireDevBackend', () => {
  it('throws 404 when locals.backend is prd', () => {
    expect(() => requireDevBackend({ backend: 'prd' } as App.Locals)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('throws 404 when locals.backend is unset', () => {
    expect(() => requireDevBackend({} as App.Locals)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('does not throw when locals.backend is dev', () => {
    expect(() => requireDevBackend({ backend: 'dev' } as App.Locals)).not.toThrow();
  });
});
