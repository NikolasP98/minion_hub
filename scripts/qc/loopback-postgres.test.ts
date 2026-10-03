import { describe, expect, it } from 'vitest';
import { qaTestDatabaseUrl, validateMarkedLoopbackPostgres } from './loopback-postgres';

describe('marked loopback PostgreSQL admission', () => {
  it('accepts only an explicit marker and loopback database URL', () => {
    const url = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';
    expect(validateMarkedLoopbackPostgres(url, '1', 'REQUIRE_QA_POSTGRES').href).toBe(url);
    expect(() => validateMarkedLoopbackPostgres(url, undefined, 'REQUIRE_QA_POSTGRES')).toThrow();
    expect(() =>
      validateMarkedLoopbackPostgres(
        'postgresql://postgres:secret@db.example/prod',
        '1',
        'REQUIRE_QA_POSTGRES',
      ),
    ).toThrow('loopback');
    expect(() =>
      validateMarkedLoopbackPostgres(
        'postgresql://postgres:secret@127.0.0.1/postgres?sslmode=require',
        '1',
        'REQUIRE_QA_POSTGRES',
      ),
    ).toThrow('loopback');
  });

  it('never falls back to the application URL outside CI', () => {
    expect(
      qaTestDatabaseUrl({
        SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
      }),
    ).toBeUndefined();
    expect(
      qaTestDatabaseUrl({
        CI: '1',
        SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
      }),
    ).toContain('127.0.0.1');
  });
});
