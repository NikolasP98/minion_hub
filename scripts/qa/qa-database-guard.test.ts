import { describe, expect, it } from 'vitest';
import { validateQaDatabaseUrl } from './qa-database-guard';

const OK = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';

describe('validateQaDatabaseUrl', () => {
  it('accepts the default loopback QA stack URL', () => {
    expect(() => validateQaDatabaseUrl(OK)).not.toThrow();
  });

  it('accepts ::1 loopback', () => {
    expect(() =>
      validateQaDatabaseUrl('postgresql://postgres:postgres@[::1]:54422/postgres'),
    ).not.toThrow();
  });

  it('rejects a missing URL', () => {
    expect(() => validateQaDatabaseUrl(undefined)).toThrow(/required/);
  });

  it('rejects a non-postgres protocol', () => {
    expect(() => validateQaDatabaseUrl('http://127.0.0.1:54422/postgres')).toThrow(/protocol/);
  });

  it('rejects an unparseable URL', () => {
    expect(() => validateQaDatabaseUrl('not a url')).toThrow(/Invalid database URL/);
  });

  it('rejects a non-loopback host — the never-prod guard', () => {
    expect(() =>
      validateQaDatabaseUrl(
        'postgresql://postgres:secret@prod-db.example.supabase.co:5432/postgres',
      ),
    ).toThrow(/non-loopback/);
  });

  it('rejects a loopback host on the wrong port by default', () => {
    expect(() =>
      validateQaDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/postgres'),
    ).toThrow(/Refusing port/);
  });

  it('allows a non-default port only with --allow-port', () => {
    const raw = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
    expect(() => validateQaDatabaseUrl(raw)).toThrow();
    expect(() => validateQaDatabaseUrl(raw, { allowPort: true })).not.toThrow();
  });

  it('never accepts localhost by hostname alone (URL does not resolve DNS; be strict)', () => {
    expect(() =>
      validateQaDatabaseUrl('postgresql://postgres:postgres@localhost:54422/postgres'),
    ).toThrow(/non-loopback/);
  });
});
