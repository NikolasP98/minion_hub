import { describe, expect, it } from 'vitest';
import { checkBaseline, type BaselineJson } from './check-baseline';

const files = ['20260101000000_a.sql', '20260102000000_b.sql'];
const goodBaseline: BaselineJson = {
  maxLedgerVersion: '20260102000000',
  migrationFilesAtSnapshot: files,
};
const goodLedger = [
  "INSERT INTO public.hub_migrations VALUES ('20260101000000', '2026-01-01 00:00:00+00');",
  "INSERT INTO public.hub_migrations VALUES ('20260102000000', '2026-01-02 00:00:00+00');",
].join('\n');
const goodSchema = ['CREATE TABLE public.foo (id uuid NOT NULL);'].join('\n');

describe('checkBaseline', () => {
  it('passes on a consistent baseline', () => {
    const result = checkBaseline({
      baselineJson: goodBaseline,
      currentMigrationFiles: files,
      ledgerSql: goodLedger,
      schemaSql: goodSchema,
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when maxLedgerVersion has no matching file on disk', () => {
    const result = checkBaseline({
      baselineJson: { ...goodBaseline, maxLedgerVersion: '20261231000000' },
      currentMigrationFiles: files,
      ledgerSql: goodLedger,
      schemaSql: goodSchema,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('maxLedgerVersion'))).toBe(true);
  });

  it('fails when migrationFilesAtSnapshot names a file removed from disk', () => {
    const result = checkBaseline({
      baselineJson: goodBaseline,
      currentMigrationFiles: ['20260101000000_a.sql'], // b.sql gone
      ledgerSql: goodLedger,
      schemaSql: goodSchema,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('20260102000000_b.sql'))).toBe(true);
  });

  it('fails when ledger.sql INSERT count does not match migrationFilesAtSnapshot.length', () => {
    const result = checkBaseline({
      baselineJson: goodBaseline,
      currentMigrationFiles: files,
      ledgerSql: goodLedger.split('\n')[0], // only 1 of 2 rows
      schemaSql: goodSchema,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('INSERT row'))).toBe(true);
  });

  it('fails when schema.sql carries a top-level INSERT (a data statement, not schema-only)', () => {
    const result = checkBaseline({
      baselineJson: goodBaseline,
      currentMigrationFiles: files,
      ledgerSql: goodLedger,
      schemaSql: goodSchema + "\nINSERT INTO public.foo (id) VALUES ('x');",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('data statement'))).toBe(true);
  });

  it('fails when schema.sql carries a top-level COPY data block', () => {
    const result = checkBaseline({
      baselineJson: goodBaseline,
      currentMigrationFiles: files,
      ledgerSql: goodLedger,
      schemaSql: goodSchema + '\nCOPY public.foo (id) FROM stdin;\nx\n\\.\n',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('data statement'))).toBe(true);
  });

  it('does NOT flag an INSERT indented inside a function body ($$ ... $$)', () => {
    const schemaWithFnBody = [
      goodSchema,
      'CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$',
      'BEGIN',
      "    INSERT INTO audit_log (msg) VALUES ('hi');",
      'END;',
      '$$;',
    ].join('\n');
    const result = checkBaseline({
      baselineJson: goodBaseline,
      currentMigrationFiles: files,
      ledgerSql: goodLedger,
      schemaSql: schemaWithFnBody,
    });
    expect(result.ok).toBe(true);
  });

  it('handles ledger.sql in COPY format (not just --inserts)', () => {
    const copyLedger = [
      'COPY public.hub_migrations (version, applied_at) FROM stdin;',
      '20260101000000\t2026-01-01 00:00:00+00',
      '20260102000000\t2026-01-02 00:00:00+00',
      '\\.',
    ].join('\n');
    const result = checkBaseline({
      baselineJson: goodBaseline,
      currentMigrationFiles: files,
      ledgerSql: copyLedger,
      schemaSql: goodSchema,
    });
    expect(result.ok).toBe(true);
  });
});
