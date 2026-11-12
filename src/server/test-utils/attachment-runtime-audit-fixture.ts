import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Sql } from 'postgres';
import { quoteCatalogIdentifier } from './captured-postgres-catalog';

/**
 * Post-capture runtime extension, not a new production catalog extraction.
 * Replay only the actual audit migration statements: this fixture does not
 * exercise session persistence and has no GoTrue sessions prerequisite.
 */
export async function applyAttachmentRuntimeAuditFixture(owner: Sql, schema: string) {
  if (!/^qc_job_stock_[a-f0-9]{32}$/.test(schema))
    throw new Error('Invalid attachment runtime namespace');
  const file = '20261108010000_role_simulation.sql';
  const source = readFileSync(
    new URL(`../../../supabase/migrations/${file}`, import.meta.url),
    'utf8',
  );
  const statements = source
    .split('--> statement-breakpoint')
    .filter((statement) =>
      /(?:alter table public\.doc_audit_log|create or replace function public\.app_attribute_simulation_audit\(|drop trigger if exists doc_audit_simulation_actor|create trigger doc_audit_simulation_actor)/i.test(
        statement,
      ),
    );
  if (statements.length !== 4)
    throw new Error('Review attachment runtime audit admission after migration shape changes');

  // Preserve every captured audit column and its table security contract.
  // Exclude only the two independently asserted, post-capture runtime columns.
  const originalCatalog = async () => ({
    columns: await owner`
      SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type,
        a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS default_expression
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname=${schema} AND c.relname='doc_audit_log'
        AND a.attnum>0 AND NOT a.attisdropped
        AND a.attname NOT IN ('simulation_role_key','simulation_generation')
      ORDER BY a.attnum`,
    security: await owner`
      SELECT c.relrowsecurity,c.relforcerowsecurity,c.relacl::text
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=${schema} AND c.relname='doc_audit_log'`,
  });
  const before = await originalCatalog();
  const runtimeSql = statements
    .join('\n')
    .replaceAll('public.', `${quoteCatalogIdentifier(schema)}.`)
    .replaceAll(
      'search_path=pg_catalog,public',
      `search_path=pg_catalog,${quoteCatalogIdentifier(schema)}`,
    );
  await owner.unsafe(runtimeSql);
  if (!isDeepStrictEqual(before, await originalCatalog()))
    throw new Error('Runtime audit extension changed the captured column/security contract');
  return {
    kind: 'post-capture-runtime-extension',
    source: `supabase/migrations/${file}`,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    statementCount: statements.length,
    mappedSqlSha256: createHash('sha256').update(runtimeSql).digest('hex'),
    preservesCapturedAuditColumnsAndSecurity: true,
  } as const;
}
