import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bridgeMigrationSql,
  correctionMigrationSql,
  openCorrectionNativeChild,
  type CorrectionNativeChild,
} from './stock-corrections.native-setup';

/**
 * F3 native correction suite (minion-meta spec 124). Registered in NATIVE_POSTGRES_MANIFEST['qa-native']
 * with exactAssertions. The names below are the contract; see the manifest entry for the admitted set.
 * Every test runs in ONE owned child database (minion_qc_faces_correction_<hex>) restored from the real
 * baseline, with the real F7 bridge and this feature's real migration.
 */
const ORG = randomUUID();
const OTHER_ORG = randomUUID();
const ACTOR = randomUUID();
const H = (c: string) => c.repeat(64);

let child: CorrectionNativeChild;
let owner: postgres.Sql;
let appClient: postgres.Sql;
let app: ReturnType<typeof drizzle>;

type Tx = Parameters<Parameters<typeof app.transaction>[0]>[0];
/** Run as app_ledger with the server's GUCs (same set_config shape as withOrgCoreTransaction). */
async function asApp<T>(orgId: string, profileId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return app.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('role','app_ledger',true), set_config('app.current_org_id',${orgId},true), set_config('app.current_profile_id',${profileId},true)`,
    );
    return fn(tx);
  });
}

async function seedEntry(orgId: string, status = 'submitted'): Promise<string> {
  const [row] =
    await owner`insert into public.stk_entries (org_id, type, status) values (${orgId}, 'receipt', ${status}) returning id`;
  return String(row.id);
}

const base = (over: Record<string, unknown>) => ({
  org_id: ORG,
  operation_key: randomUUID(),
  kind: 'receipt_replace',
  source_type: 'stock_receipt',
  source_id: randomUUID(),
  source_entry_id: null as string | null,
  replacement_entry_id: null as string | null,
  payload_hash: H('a'),
  preview_hash: H('b'),
  reason: 'typo',
  actor_id: ACTOR,
  ...over,
});

async function insertCorrection(row: ReturnType<typeof base>, as = ACTOR, orgId = ORG) {
  await asApp(orgId, as, (tx) =>
    tx.execute(sql`insert into public.stk_corrections
      (org_id, operation_key, kind, source_type, source_id, source_entry_id, replacement_entry_id,
       payload_hash, preview_hash, reason, actor_id, before, intended, after, applied_at)
      values (${row.org_id}, ${row.operation_key}, ${row.kind}, ${row.source_type}, ${row.source_id},
       ${row.source_entry_id}, ${row.replacement_entry_id}, ${row.payload_hash}, ${row.preview_hash},
       ${row.reason}, ${row.actor_id}, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())`),
  );
}

/** drizzle wraps driver errors; the SQL message lives on the cause chain. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    let message = '';
    for (let e: unknown = error, i = 0; e instanceof Error && i < 5; e = e.cause, i += 1)
      message += ` ${e.message}`;
    return message;
  }
  throw new Error('expected the statement to be rejected');
}

beforeAll(async () => {
  child = await openCorrectionNativeChild();
  owner = child.owner;
  appClient = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => undefined });
  app = drizzle(appClient);
  await owner.unsafe(bridgeMigrationSql());
  await owner.unsafe(correctionMigrationSql());
}, 180_000);

afterAll(async () => {
  await appClient?.end({ timeout: 5 });
  await child?.close();
});

describe('stock corrections against PostgreSQL', () => {
  it('enforces tenant scoped five kind schema immutable grants and private source ownership', async () => {
    const a = await seedEntry(ORG);
    const b = await seedEntry(ORG);
    const foreign = await seedEntry(OTHER_ORG);

    // The five kinds, each with its own nullability matrix.
    await insertCorrection(
      base({ kind: 'receipt_replace', source_entry_id: a, replacement_entry_id: b }),
    );
    await insertCorrection(
      base({ kind: 'receipt_chain', source_entry_id: a, replacement_entry_id: b }),
    );
    await insertCorrection(
      base({
        kind: 'sale_stock_repost',
        source_type: 'pos_ticket_line',
        source_entry_id: a,
        replacement_entry_id: b,
      }),
    );
    await insertCorrection(
      base({
        kind: 'sale_variant',
        source_type: 'pos_ticket_line',
        source_entry_id: a,
        replacement_entry_id: b,
      }),
    );
    // Stockless swap (no entries) and "every stock line removed" (source only) are valid sale_variant shapes.
    await insertCorrection(base({ kind: 'sale_variant', source_type: 'pos_ticket_line' }));
    await insertCorrection(
      base({ kind: 'sale_variant', source_type: 'pos_ticket_line', source_entry_id: a }),
    );
    await insertCorrection(base({ kind: 'product_mapping', source_type: 'fin_product' }));

    const bad = async (over: Record<string, unknown>, pattern: RegExp) =>
      expect(await rejection(insertCorrection(base(over)))).toMatch(pattern);
    // Kind / source / nullability matrix.
    await bad({ kind: 'sale_replace' }, /stk_corrections_kind_chk/);
    await bad({ source_type: 'booking' }, /stk_corrections_(kind_matrix|source_type)_chk/);
    await bad(
      { kind: 'product_mapping', source_type: 'fin_product', source_entry_id: a },
      /kind_matrix/,
    );
    await bad(
      { kind: 'sale_variant', source_type: 'pos_ticket_line', replacement_entry_id: b },
      /kind_matrix/,
    );
    await bad(
      { kind: 'sale_stock_repost', source_type: 'pos_ticket_line', source_entry_id: a },
      /kind_matrix/,
    );
    await bad({ kind: 'receipt_replace', source_entry_id: a }, /kind_matrix/);
    await bad(
      {
        kind: 'receipt_replace',
        source_type: 'fin_product',
        source_entry_id: a,
        replacement_entry_id: b,
      },
      /kind_matrix/,
    );
    // Hash / reason / size.
    await bad(
      { payload_hash: 'A'.repeat(64), source_entry_id: a, replacement_entry_id: b },
      /payload_hash_chk/,
    );
    await bad(
      { preview_hash: 'short', source_entry_id: a, replacement_entry_id: b },
      /preview_hash_chk/,
    );
    await bad({ reason: '   ', source_entry_id: a, replacement_entry_id: b }, /reason_chk/);
    await bad(
      { reason: 'x'.repeat(1001), source_entry_id: a, replacement_entry_id: b },
      /reason_chk/,
    );
    expect(
      await rejection(
        asApp(ORG, ACTOR, (tx) =>
          tx.execute(sql`insert into public.stk_corrections
            (org_id, operation_key, kind, source_type, source_id, payload_hash, preview_hash, reason, actor_id,
             before, intended, after, applied_at)
            values (${ORG}, ${randomUUID()}, 'product_mapping', 'fin_product', ${randomUUID()}, ${H('a')}, ${H('b')},
             'big', ${ACTOR}, jsonb_build_object('x', repeat('x', 4194304)), '{}'::jsonb, '{}'::jsonb, now())`),
        ),
      ),
    ).toMatch(/json_size_chk/);
    // Foreign-org entry reference: composite same-org FK.
    await bad({ source_entry_id: foreign, replacement_entry_id: b }, /source_entry_fk/);
    await bad({ source_entry_id: a, replacement_entry_id: foreign }, /replacement_entry_fk/);

    // Operation key: one namespace per org; the same key in another org is a different operation.
    const key = randomUUID();
    await insertCorrection(
      base({ operation_key: key, kind: 'product_mapping', source_type: 'fin_product' }),
    );
    await bad(
      { operation_key: key, kind: 'product_mapping', source_type: 'fin_product' },
      /operation_key_uniq/,
    );
    await insertCorrection(
      base({
        org_id: OTHER_ORG,
        operation_key: key,
        kind: 'product_mapping',
        source_type: 'fin_product',
      }),
      ACTOR,
      OTHER_ORG,
    );
    // A receipt is valuation-corrected at most once.
    const c = await seedEntry(ORG);
    const d = await seedEntry(ORG);
    const e = await seedEntry(ORG);
    await insertCorrection(
      base({ kind: 'receipt_chain', source_entry_id: c, replacement_entry_id: d }),
    );
    await bad(
      { kind: 'receipt_chain', source_entry_id: c, replacement_entry_id: e },
      /receipt_chain_source_uniq/,
    );
    // A plain receipt_replace of the same source is not blocked by that partial index.
    await insertCorrection(
      base({ kind: 'receipt_replace', source_entry_id: c, replacement_entry_id: e }),
    );

    // Tenant scoping: wrong org GUC and wrong actor are refused by RLS; reads see only the own org.
    expect(
      await rejection(
        insertCorrection(base({ source_entry_id: a, replacement_entry_id: b }), ACTOR, OTHER_ORG),
      ),
    ).toMatch(/row-level security/);
    expect(
      await rejection(
        insertCorrection(base({ source_entry_id: a, replacement_entry_id: b }), randomUUID()),
      ),
    ).toMatch(/row-level security/);
    const own = await asApp(ORG, ACTOR, (tx) =>
      tx.execute(sql`select count(*)::int as n from public.stk_corrections where org_id <> ${ORG}`),
    );
    expect((own as unknown as Array<{ n: number }>)[0].n).toBe(0);

    // Immutable: no UPDATE / DELETE / TRUNCATE for the application role, and no direct anon/authenticated access.
    expect(
      await rejection(
        asApp(ORG, ACTOR, (tx) =>
          tx.execute(sql`update public.stk_corrections set reason = 'edited'`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejection(
        asApp(ORG, ACTOR, (tx) => tx.execute(sql`delete from public.stk_corrections`)),
      ),
    ).toMatch(/permission denied/);
    const [grants] = await owner`select
      has_table_privilege('app_ledger','public.stk_corrections','SELECT') as sel,
      has_table_privilege('app_ledger','public.stk_corrections','INSERT') as ins,
      has_table_privilege('app_ledger','public.stk_corrections','UPDATE') as upd,
      has_table_privilege('app_ledger','public.stk_corrections','DELETE') as del,
      has_table_privilege('anon','public.stk_corrections','SELECT') as anon,
      has_table_privilege('authenticated','public.stk_corrections','SELECT') as auth,
      (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.stk_corrections'::regclass) as forced`;
    expect(grants).toMatchObject({
      sel: true,
      ins: true,
      upd: false,
      del: false,
      anon: false,
      auth: false,
      forced: true,
    });
    // The actor is a historical soft reference: no profile/auth FK, so deleting the account keeps the receipt.
    const fks =
      await owner`select conname from pg_constraint where conrelid='public.stk_corrections'::regclass and contype='f' order by conname`;
    expect(fks.map((r) => r.conname)).toEqual([
      'stk_corrections_replacement_entry_fk',
      'stk_corrections_source_entry_fk',
    ]);
    // Re-applying the migration is a no-op (idempotent).
    await owner.unsafe(correctionMigrationSql());
  });
});
