import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig, pgTable, text, index, primaryKey } from 'drizzle-orm/pg-core';

const json = <T>(f: string): T => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const frozen = new Set(json<string[]>('./tables-frozen.json'));
const exceptions = json<{ name: string; reason: string }[]>('./tables-exceptions.json');

/** Returns why `table` breaks the rule, or null when it conforms. */
export function orgViolation(table: PgTable): string | null {
  const cfg = getTableConfig(table);
  const col = cfg.columns.find((c) => c.name === 'org_id');
  if (!col) return 'no org_id column';
  if (col.dataType !== 'string' || !col.notNull) return 'org_id must be text and notNull';
  const leads =
    cfg.indexes.some(
      (i) =>
        i.config.columns[0] &&
        'name' in i.config.columns[0] &&
        i.config.columns[0].name === 'org_id',
    ) ||
    cfg.primaryKeys.some((p) => p.columns[0]?.name === 'org_id') ||
    cfg.columns.some((c) => c.primary && c.name === 'org_id');
  return leads ? null : 'no index or primary key with org_id as first column';
}

describe('H1b: new tables carry org_id', () => {
  it('flags a table without org_id (D5)', () => {
    expect(orgViolation(pgTable('t_a', { id: text('id').primaryKey() }))).toMatch(/no org_id/);
  });
  it('flags org_id without an org-leading index (D5)', () => {
    const t = pgTable('t_b', { id: text('id').primaryKey(), orgId: text('org_id').notNull() });
    expect(orgViolation(t)).toMatch(/first column/);
  });
  it('accepts a conforming table (D5)', () => {
    const t = pgTable('t_c', { id: text('id').notNull(), orgId: text('org_id').notNull() }, (x) => [
      index('t_c_org_idx').on(x.orgId, x.id),
    ]);
    expect(orgViolation(t)).toBeNull();
    const p = pgTable('t_d', { id: text('id').notNull(), orgId: text('org_id').notNull() }, (x) => [
      primaryKey({ columns: [x.orgId, x.id] }),
    ]);
    expect(orgViolation(p)).toBeNull();
  });

  it('every non-frozen, non-excepted table has org_id and an org-leading index', async () => {
    const files = [
      ...globSync('src/server/db/pg-*-schema.ts'),
      ...globSync('src/server/db/pg-schema/*.ts'),
    ];
    const tables = new Map<string, PgTable>();
    for (const f of files) {
      const mod = (await import(/* @vite-ignore */ `../../${f}`)) as Record<string, unknown>;
      for (const v of Object.values(mod)) if (is(v, PgTable)) tables.set(getTableConfig(v).name, v);
    }
    const gone = [...frozen].filter((n) => !tables.has(n));
    expect(gone, `tables-frozen.json names no longer in the schema; remove them: ${gone}`).toEqual(
      [],
    );
    const skip = new Set(exceptions.map((e) => e.name));
    const bad = [...tables]
      .filter(([n]) => !frozen.has(n) && !skip.has(n))
      .map(([n, t]) => `${n}: ${orgViolation(t)}`)
      .filter((m) => !m.endsWith('null'));
    expect(
      bad,
      `New tables must have a non-null text org_id and an index or primary key that starts with org_id. ` +
        `Fix the table, or, if it is platform-wide, add { "name", "reason" } to scripts/house-rules/tables-exceptions.json.`,
    ).toEqual([]);
  });
});
