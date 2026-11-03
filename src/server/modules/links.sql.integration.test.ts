import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { stockServer } from './stock.server';

const databaseUrl = testDatabaseUrl();
const sql = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;

// Every single-column foreign key in `public`, as `table.column` → `table.column`.
async function foreignKeys(): Promise<{ from: string; to: string }[]> {
  return sql!<{ from: string; to: string }[]>`
    select kcu.table_name || '.' || kcu.column_name as "from",
           ref.table_name || '.' || ref.column_name as "to"
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_schema = rc.constraint_schema
       and kcu.constraint_name = rc.constraint_name
      join information_schema.key_column_usage ref
        on ref.constraint_schema = rc.unique_constraint_schema
       and ref.constraint_name = rc.unique_constraint_name
       and ref.ordinal_position = kcu.position_in_unique_constraint
     where rc.constraint_schema = 'public'`;
}

const isStock = (ref: string) => ref.startsWith('stk_');

describe.runIf(Boolean(databaseUrl))('stock module links against PostgreSQL', () => {
  afterAll(async () => {
    await sql?.end();
  });

  it('every declared link joins two real columns, with a foreign key unless it is soft', async () => {
    const columns = new Set(
      (
        await sql!<{ ref: string }[]>`
          select table_name || '.' || column_name as ref
            from information_schema.columns where table_schema = 'public'`
      ).map((r) => r.ref),
    );
    const fks = new Set((await foreignKeys()).map((fk) => `${fk.from}>${fk.to}`));
    for (const link of stockServer.links) {
      expect(columns, link.from).toContain(link.from);
      expect(columns, link.to).toContain(link.to);
      expect(fks.has(`${link.from}>${link.to}`), `${link.from} → ${link.to}`).toBe(!link.soft);
    }
  });

  it('every foreign key between a stk_ table and another module is declared', async () => {
    const declared = new Set(
      stockServer.links.filter((l) => !l.soft).map((l) => `${l.from}>${l.to}`),
    );
    const crossModule = (await foreignKeys()).filter((fk) => isStock(fk.from) !== isStock(fk.to));
    expect(crossModule.filter((fk) => !declared.has(`${fk.from}>${fk.to}`))).toEqual([]);
  });
});
