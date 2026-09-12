import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  mergeCapturedCatalogs,
  capturedPostgresDdl,
  type CapturedCatalog,
} from './captured-postgres-catalog';
const load = (name: string): CapturedCatalog =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).catalog;
describe('captured catalog composition', () => {
  it('deduplicates exactly equal definitions while preserving the real auth substrate', () => {
    const domain = mergeCapturedCatalogs(
      load('attachment-catalog.json'),
      load('attachment-catalog.json'),
    );
    expect(domain.relations).toHaveLength(18);
    const schema = 'qc_job_stock_00000000000000000000000000000001';
    const ddl = capturedPostgresDdl(
      schema,
      `${schema}_auth`,
      domain,
      load('attachment-auth-catalog.json'),
    );
    expect(ddl).toContain(
      'GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED',
    );
    expect(ddl).toContain('on_auth_user_created');
    expect(ddl).not.toContain('public.');
    expect(ddl).not.toContain('auth.users');
  });
  it('rejects a changed overlap rather than substituting a weaker schema', () => {
    const original = load('attachment-catalog.json');
    const changed = structuredClone(original);
    changed.columns[0].attnotnull = !changed.columns[0].attnotnull;
    expect(() => mergeCapturedCatalogs(original, changed)).toThrow('Conflicting captured columns');
  });
});
