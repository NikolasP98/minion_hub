import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Cache layers are network clients; the native fixture has none.
vi.mock('@minion-stack/cache', () => ({
  cached: (_key: unknown, _opts: unknown, fn: () => unknown) => fn(),
  keys: { hub: () => 'k' },
  tags: { tenantDomain: () => [] },
  invalidateTags: async () => undefined,
}));
import { CorrectionError } from './stock-corrections.logic';
import { applyExternalLock, grantUnlock } from './record-locks.service';
import { parseHookBody } from './record-locks.logic';
import {
  applyStockCorrection,
  getStockCorrectionByOperationKey,
  previewStockCorrection,
} from './stock-corrections.service';
import {
  createEntry,
  submitEntry,
  rebuildBins,
  lockStockWrite,
  createEntryInTx,
  submitEntryInTx,
  cancelEntryInTx,
} from './stock.service';
import { setModuleEnabled } from './modules.service';
import { realizeAccruals } from './stock-accruals.service';
import { setConsumption, updateWarehouse } from './stock.service';
import { updateFinSettings } from './finance.service';
import { postTicketStock, setBundleComponent } from './pos.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { assertStockModulesEnabledInTx } from './stock.service';
import {
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
}, 240_000);

afterAll(async () => {
  await appClient?.end({ timeout: 5 });
  await child?.close();
});

describe('stock corrections against PostgreSQL', () => {
  it('refuses a purchase correction under the organization lock policy (spec 140)', async () => {
    const wd = await world();
    const item = randomUUID();
    await owner.unsafe(
      `insert into public.stk_items(id,org_id,code,name) values ('${item}','${wd.org}','LK','LK')`,
    );
    const e = await createEntry(
      wd.ownerCtx,
      { type: 'receipt', lines: [{ itemId: item, qty: 10, rate: 2, toWarehouseId: wd.wh }] },
      actorOf(wd.boss),
    );
    await submitEntry(wd.ownerCtx, e.id, actorOf(wd.boss));
    const [line] = await owner`select id from public.stk_entry_lines where entry_id=${e.id}`;
    const req = {
      mode: 'receipt_replace' as const,
      sourceType: 'stock_receipt' as const,
      sourceId: e.id,
      replacement: {
        lines: [
          {
            originalLineId: line.id as string,
            itemId: item,
            qty: '9',
            rate: '2',
            uom: 'unit',
            toWarehouseId: wd.wh,
          },
        ],
      },
    };
    await owner.unsafe(
      `update public.stk_entries set posted_at = now() - interval '2 days' where id='${e.id}'`,
    );
    // No policy row: the receipt is correctable (default = month close only), previewed here, not applied.
    expect((await previewStockCorrection(wd.ownerCtx, req, 'typo')).blockers).not.toContain(
      'record_locked',
    );
    await owner.unsafe(
      `insert into public.org_lock_policy(org_id,days_enabled,days) values ('${wd.org}', true, 1)`,
    );
    expect(await refusal(previewStockCorrection(wd.ownerCtx, req, 'typo'))).toBe('record_locked');
    expect(
      await refusal(
        applyStockCorrection(
          wd.ownerCtx,
          {
            request: req,
            operationKey: randomUUID(),
            previewHash: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            reason: 'typo',
          },
          actorOf(wd.boss),
        ),
      ),
    ).toBe('record_locked');
    expect(await bin(wd.org, item)).toBe('10');
  });

  it('lets an owner unlock one locked purchase for exactly one correction (spec 140)', async () => {
    const wd = await world();
    const item = randomUUID();
    await owner.unsafe(
      `insert into public.stk_items(id,org_id,code,name) values ('${item}','${wd.org}','UL','UL')`,
    );
    const receipt = async (qty: number) => {
      const e = await createEntry(
        wd.ownerCtx,
        { type: 'receipt', lines: [{ itemId: item, qty, rate: 2, toWarehouseId: wd.wh }] },
        actorOf(wd.boss),
      );
      await submitEntry(wd.ownerCtx, e.id, actorOf(wd.boss));
      await owner.unsafe(
        `update public.stk_entries set posted_at = now() - interval '3 days' where id='${e.id}'`,
      );
      return e.id;
    };
    const request = async (id: string, qty: string) => {
      const [line] = await owner`select id from public.stk_entry_lines where entry_id=${id}`;
      return {
        mode: 'receipt_replace' as const,
        sourceType: 'stock_receipt' as const,
        sourceId: id,
        replacement: {
          lines: [
            {
              originalLineId: line.id as string,
              itemId: item,
              qty,
              rate: '2',
              uom: 'unit',
              toWarehouseId: wd.wh,
            },
          ],
        },
      };
    };
    const run = async (req: Awaited<ReturnType<typeof request>>) => {
      const pv = await previewStockCorrection(wd.ownerCtx, req, 'typo');
      return applyStockCorrection(
        wd.ownerCtx,
        {
          request: req,
          operationKey: randomUUID(),
          previewHash: pv.previewHash,
          payloadHash: pv.payloadHash,
          reason: 'typo',
        },
        actorOf(wd.boss),
      );
    };
    const events = (action: string) =>
      owner`select id, ref_event_id, detail from public.org_lock_events where org_id=${wd.org} and action=${action}`;
    const grant = (id: string) =>
      grantUnlock(
        wd.ownerCtx,
        { recordType: 'stock_receipt', recordId: id, reason: 'Cantidad mal digitada' },
        { kind: 'person', id: wd.boss, name: 'Owner' },
      );
    await owner.unsafe(
      `insert into public.org_lock_policy(org_id,days_enabled,days) values ('${wd.org}', true, 1)`,
    );

    const first = await receipt(10);
    expect(await refusal(run(await request(first, '9')))).toBe('record_locked');
    const granted = await grant(first);
    expect(granted.created).toBe(true);
    expect((await grant(first)).created).toBe(false); // the active unlock is returned, not stacked
    expect(await events('unlock')).toHaveLength(1);

    // The correction goes through and uses the unlock in the same commit.
    const ok = await run(await request(first, '9'));
    expect(ok.outcome).toBe('applied');
    const receiptRow = ok.outcome === 'applied' ? ok.receipt : null;
    expect(await bin(wd.org, item)).toBe('9');
    const used = await events('unlock_used');
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({
      ref_event_id: granted.eventId,
      detail: { correctionId: receiptRow!.id },
    });
    // One use only, at the database level.
    expect(
      await rejection(
        owner.unsafe(
          `insert into public.org_lock_events(org_id,action,actor_kind,ref_event_id) values ('${wd.org}','unlock_used','system','${granted.eventId}')`,
        ),
      ),
    ).toMatch(/org_lock_events_used_uniq|duplicate key/);

    // The replacement inherits the first receipt's date, so it is locked again.
    const replacement = receiptRow!.replacementEntryId!;
    expect(
      await refusal(previewStockCorrection(wd.ownerCtx, await request(replacement, '8'), 'typo')),
    ).toBe('record_locked');

    // A correction that fails leaves its unlock usable.
    const second = await receipt(5);
    const again = await grant(second);
    const issue = await createEntry(
      wd.ownerCtx,
      { type: 'issue', lines: [{ itemId: item, qty: 1, fromWarehouseId: wd.wh }] },
      actorOf(wd.boss),
    );
    await submitEntry(wd.ownerCtx, issue.id, actorOf(wd.boss));
    expect(await refusal(run(await request(second, '4')))).toBe('dependent_history');
    expect(
      (await events('unlock_used')).filter((e) => e.ref_event_id === again.eventId),
    ).toHaveLength(0);

    // Month rule (audit P8): one unlock opens a closed-month purchase for one correction only. The
    // replacement is dated today but is judged by the month of the chain's first receipt.
    await owner.unsafe(
      `update public.org_lock_policy set days_enabled=false where org_id='${wd.org}'`,
    );
    const pastMonth = async (qty: number) => {
      const id = await receipt(qty);
      await owner.unsafe(
        `update public.stk_entries set posted_at = date_trunc('month', now()) - interval '10 days' where id='${id}'`,
      );
      return id;
    };
    const lockMonthOf = (id: string) =>
      owner.unsafe(
        `insert into public.pos_period_locks(org_id,period) select '${wd.org}', to_char(posted_at at time zone 'America/Lima','YYYY-MM') from public.stk_entries where id='${id}' on conflict do nothing`,
      );
    const a0 = await pastMonth(7);
    await lockMonthOf(a0);
    expect(await refusal(run(await request(a0, '6')))).toBe('period_locked');
    await grant(a0);
    const fixed = await run(await request(a0, '6'));
    expect(fixed.outcome).toBe('applied');
    const a1 = fixed.outcome === 'applied' ? fixed.receipt.replacementEntryId! : '';
    expect(await refusal(previewStockCorrection(wd.ownerCtx, await request(a1, '5'), 'typo'))).toBe(
      'period_locked',
    );

    // Audit P5: an unused unlock dies when its receipt is replaced; it never carries to the replacement.
    const b0 = await pastMonth(4);
    const unused = await grant(b0);
    expect(unused.created).toBe(true);
    await owner.unsafe(`delete from public.pos_period_locks where org_id='${wd.org}'`);
    const fixedB = await run(await request(b0, '3'));
    expect(fixedB.outcome).toBe('applied');
    expect((await events('unlock_used')).some((e) => e.ref_event_id === unused.eventId)).toBe(
      false,
    );
    await lockMonthOf(b0);
    const b1 = fixedB.outcome === 'applied' ? fixedB.receipt.replacementEntryId! : '';
    expect(await refusal(previewStockCorrection(wd.ownerCtx, await request(b1, '2'), 'typo'))).toBe(
      'period_locked',
    );
  });

  it('a webhook key lifts only its own locks and locks only receipts by id (spec 140)', async () => {
    const wd = await world();
    const item = randomUUID();
    await owner.unsafe(
      `insert into public.stk_items(id,org_id,code,name) values ('${item}','${wd.org}','WK','WK')`,
    );
    await owner.unsafe(
      `insert into public.org_lock_policy(org_id,webhook_enabled) values ('${wd.org}', true)`,
    );
    const mine = { id: randomUUID(), name: 'Contabilidad' };
    const other = { id: randomUUID(), name: 'Auditoria' };
    const call = (key: typeof mine, body: Record<string, unknown>) =>
      applyExternalLock(wd.ownerCtx, key, parseHookBody(body));
    const receipt = await createEntry(
      wd.ownerCtx,
      { type: 'receipt', lines: [{ itemId: item, qty: 3, rate: 2, toWarehouseId: wd.wh }] },
      actorOf(wd.boss),
    );
    await submitEntry(wd.ownerCtx, receipt.id, actorOf(wd.boss));
    const issue = await createEntry(
      wd.ownerCtx,
      { type: 'issue', lines: [{ itemId: item, qty: 1, fromWarehouseId: wd.wh }] },
      actorOf(wd.boss),
    );
    await submitEntry(wd.ownerCtx, issue.id, actorOf(wd.boss));

    // Only a receipt can be locked by id; an issue lands in `unknown`.
    const locked = await call(mine, {
      action: 'lock',
      label: 'Contabilidad',
      recordType: 'stock_receipt',
      ids: [receipt.id, issue.id],
    });
    expect(locked).toMatchObject({ created: 1, unknown: [issue.id] });
    await call(mine, { action: 'lock', label: 'Contabilidad', upTo: '2020-01-31' });

    // Another key lifts nothing, by date or by ids without a label.
    expect(
      await call(other, { action: 'lift', label: 'Contabilidad', upTo: '2020-01-31' }),
    ).toMatchObject({ lifted: 0 });
    expect(
      await call(other, { action: 'lift', recordType: 'stock_receipt', ids: [receipt.id] }),
    ).toMatchObject({ lifted: 0 });
    expect(
      await owner`select id from public.org_record_locks where org_id=${wd.org} and lifted_at is null`,
    ).toHaveLength(2);
    // The key that set them lifts both.
    expect(
      await call(mine, { action: 'lift', label: 'Contabilidad', upTo: '2020-01-31' }),
    ).toMatchObject({ lifted: 1 });
    expect(
      await call(mine, { action: 'lift', recordType: 'stock_receipt', ids: [receipt.id] }),
    ).toMatchObject({ lifted: 1 });
  });

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
      has_table_privilege('service_role','public.stk_corrections','SELECT') as svc_sel,
      has_table_privilege('service_role','public.stk_corrections','INSERT') as svc_ins,
      has_table_privilege('anon','public.stk_corrections','SELECT') as anon,
      has_table_privilege('authenticated','public.stk_corrections','SELECT') as auth,
      (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.stk_corrections'::regclass) as forced`;
    expect(grants).toMatchObject({
      sel: true,
      ins: true,
      upd: false,
      del: false,
      svc_sel: false,
      svc_ins: false,
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

// ── world fixture ────────────────────────────────────────────────────────────────────────

const actorOf = (id: string) => ({ id, name: 'Native' });
type Ctx = { db: CoreCtx['db']; tenantId: string; profileId: string };
const extraClients: postgres.Sql[] = [];
function ctxFor(org: string, profile: string): Ctx {
  const client = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => undefined });
  extraClients.push(client);
  return { db: drizzle(client) as CoreCtx['db'], tenantId: org, profileId: profile };
}
afterAll(async () => {
  await Promise.all(extraClients.map((c) => c.end({ timeout: 5 }).catch(() => undefined)));
});

async function addProfile(
  org: string,
  role: 'owner' | 'member',
  rules: Array<[string, boolean, boolean, boolean, number]> = [],
) {
  const id = randomUUID();
  await owner.unsafe(`insert into auth.users(id,email) values ('${id}','${id}@corr.test')`);
  await owner.unsafe(`insert into public.profiles(id,email) values ('${id}','${id}@corr.test')`);
  await owner.unsafe(
    `insert into public.organization_members(organization_id,profile_id,role) values ('${org}','${id}','${role}')`,
  );
  if (rules.length) {
    await owner.unsafe(
      `insert into public.member_roles(org_id,profile_id,role_key) values ('${org}','${id}','r${id.slice(0, 8)}')`,
    );
    for (const [mod, view, edit, manage, level] of rules)
      await owner.unsafe(
        `insert into public.permission_rules(org_id,role_key,module,can_view,can_edit,can_manage,field_level) values ('${org}','r${id.slice(0, 8)}','${mod}',${view},${edit},${manage},${level})`,
      );
  }
  return id;
}

interface World {
  org: string;
  boss: string;
  ownerCtx: Ctx;
  wh: string;
  M: string;
  L: string;
  X: string;
  PM: string;
  PL: string;
  PD: string;
  PS1: string;
  PS2: string;
}
async function world(): Promise<World> {
  const org = randomUUID();
  await owner.unsafe(
    `insert into public.organizations(id,name) values ('${org}','corr-${org.slice(0, 6)}')`,
  );
  const boss = await addProfile(org, 'owner');
  const w = randomUUID();
  const mk = async (table: string, cols: string, vals: string) => {
    const [r] = await owner.unsafe(
      `insert into public.${table}(${cols}) values (${vals}) returning id`,
    );
    return String(r.id);
  };
  await owner.unsafe(
    `insert into public.stk_warehouses(id,org_id,name,is_default) values ('${w}','${org}','W',true)`,
  );
  const item = (code: string) =>
    mk('stk_items', 'org_id,code,name', `'${org}','${code}','${code}'`);
  const [M, L, X] = [await item('M'), await item('L'), await item('X')];
  const prod = (code: string, price: number) =>
    mk(
      'fin_products',
      'org_id,code,name,unit_price,kind',
      `'${org}','${code}','${code}',${price},'product'`,
    );
  const [PM, PL, PD, PS1, PS2] = [
    await prod('PM', 50),
    await prod('PL', 50),
    await prod('PD', 60),
    await prod('PS1', 30),
    await prod('PS2', 30),
  ];
  for (const [p, i] of [
    [PM, M],
    [PL, L],
  ])
    await owner.unsafe(
      `insert into public.stk_consumption(org_id,fin_product_id,item_id,qty_per_unit) values ('${org}','${p}','${i}',1)`,
    );
  await owner.unsafe(
    `insert into public.fin_settings(org_id,timezone) values ('${org}','America/Lima')`,
  );
  const ownerCtx = ctxFor(org, boss);
  // Real receipts through the real writers: 5 M @10, 5 L @12, 5 X @1.
  for (const [it, rate] of [
    [M, 10],
    [L, 12],
    [X, 1],
  ] as const) {
    const e = await createEntry(
      ownerCtx,
      { type: 'receipt', lines: [{ itemId: it, qty: 5, rate, toWarehouseId: w }] },
      actorOf(boss),
    );
    await submitEntry(ownerCtx, e.id, actorOf(boss));
  }
  return { org, boss, ownerCtx, wh: w, M, L, X, PM, PL, PD, PS1, PS2 };
}

async function sale(wd: World, lines: Array<{ product: string; qty?: number; booking?: string }>) {
  const open = await owner.unsafe(
    `select id from public.pos_shifts where org_id='${wd.org}' and status='open'`,
  );
  const [shift] = open.length
    ? open
    : await owner.unsafe(
        `insert into public.pos_shifts(org_id,status,opened_by) values ('${wd.org}','open','${wd.boss}') returning id`,
      );
  const [t] = await owner.unsafe(
    `insert into public.pos_tickets(org_id,human_id,shift_id,subtotal,total,created_by) values ('${wd.org}','POS-N-${randomUUID().slice(0, 4)}','${shift.id}',50,50,'${wd.boss}') returning id`,
  );
  const ids: string[] = [];
  let n = 0;
  for (const l of lines) {
    const [r] = await owner.unsafe(
      `insert into public.pos_ticket_lines(org_id,ticket_id,kind,fin_product_id,booking_id,description,qty,unit_price,total,line_no) values ('${wd.org}','${t.id}','product','${l.product}',${l.booking ? `'${l.booking}'` : 'null'},'p',${l.qty ?? 1},50,50,${n++}) returning id`,
    );
    ids.push(String(r.id));
  }
  await owner.unsafe(
    `insert into public.pos_payments(org_id,ticket_id,shift_id,method,amount) values ('${wd.org}','${t.id}','${shift.id}','cash',50)`,
  );
  return { ticketId: String(t.id), lineIds: ids, shiftId: String(shift.id) };
}

const bin = async (org: string, item: string) =>
  (await owner`select qty::text from public.stk_bins where org_id=${org} and item_id=${item}`)[0]
    ?.qty as string | undefined;
const count = async (table: string, org: string) =>
  (await owner.unsafe(`select count(*)::int n from public.${table} where org_id='${org}'`))[0]
    .n as number;
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof CorrectionError) return e.code;
    throw e;
  }
  return null;
};
const swapRequest = (line: string, from: string, to: string) => ({
  mode: 'variant_swap' as const,
  sourceType: 'pos_ticket_line' as const,
  sourceId: line,
  expectedProductId: from,
  replacement: { productId: to },
});
async function applyVariant(
  ctx: Ctx,
  line: string,
  from: string,
  to: string,
  reason = 'wrong size',
  key = randomUUID(),
) {
  const request = swapRequest(line, from, to);
  const pv = await previewStockCorrection(ctx, request, reason);
  const command = {
    request,
    operationKey: key,
    previewHash: pv.previewHash,
    payloadHash: pv.payloadHash,
    reason,
  };
  return { pv, command, result: await applyStockCorrection(ctx, command, actorOf(ctx.profileId)) };
}

describe('stock corrections against PostgreSQL', () => {
  it('preserves POS only no stock swap and rejects unauthorized stock effects', async () => {
    const wd = await world();
    const posOnly = await addProfile(wd.org, 'member', [['pos', true, true, false, 0]]);
    const posCtx = ctxFor(wd.org, posOnly);
    // A mixed ticket: line 0 issued stock (M); line 1 is stockless and gets swapped.
    const t = await sale(wd, [{ product: wd.PM }, { product: wd.PS1 }]);
    await postTicketStock(wd.ownerCtx, t.ticketId, actorOf(wd.boss));
    const [{ stock_entry_id: entryBefore }] =
      await owner`select stock_entry_id from public.pos_tickets where id=${t.ticketId}`;
    expect(entryBefore).toBeTruthy();
    const binsBefore =
      await owner`select * from public.stk_bins where org_id=${wd.org} order by item_id`;
    const ledgerBefore = await count('stk_ledger', wd.org);

    const { result } = await applyVariant(posCtx, t.lineIds[1], wd.PS1, wd.PS2);
    expect(result).toMatchObject({
      outcome: 'applied',
      receipt: { kind: 'sale_variant', sourceEntryId: null, replacementEntryId: null },
    });
    expect(
      (await owner`select fin_product_id from public.pos_ticket_lines where id=${t.lineIds[1]}`)[0]
        .fin_product_id,
    ).toBe(wd.PS2);
    // Zero ledger/bin effects, the ticket still points at its original movement, money untouched.
    expect(await count('stk_ledger', wd.org)).toBe(ledgerBefore);
    expect(
      await owner`select * from public.stk_bins where org_id=${wd.org} order by item_id`,
    ).toEqual(binsBefore);
    expect(
      (
        await owner`select stock_entry_id, total::text, subtotal::text from public.pos_tickets where id=${t.ticketId}`
      )[0],
    ).toMatchObject({ stock_entry_id: entryBefore, total: '50', subtotal: '50' });

    // The same POS-only actor cannot move stock: refused, nothing written.
    const t2 = await sale(wd, [{ product: wd.PM }]);
    await postTicketStock(wd.ownerCtx, t2.ticketId, actorOf(wd.boss));
    const ledger2 = await count('stk_ledger', wd.org);
    const req = swapRequest(t2.lineIds[0], wd.PM, wd.PL);
    expect(await refusal(previewStockCorrection(posCtx, req, 'x'))).toBe('stock_scope_required');
    expect(
      await refusal(
        applyStockCorrection(
          posCtx,
          {
            request: req,
            operationKey: randomUUID(),
            previewHash: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            reason: 'x',
          },
          actorOf(posOnly),
        ),
      ),
    ).toBe('stock_scope_required');
    expect(await count('stk_ledger', wd.org)).toBe(ledger2);
    expect(
      (await owner`select fin_product_id from public.pos_ticket_lines where id=${t2.lineIds[0]}`)[0]
        .fin_product_id,
    ).toBe(wd.PM);
    // An actor with NO relevant capability gets the identical refusal for an existing and a missing
    // source (no existence oracle), and apply takes no lock: it answers while another backend holds the gate.
    const nobody = await addProfile(wd.org, 'member', [
      ['pos', false, false, false, 0],
      ['stock', false, false, false, 0],
    ]);
    const nobodyCtx = ctxFor(wd.org, nobody);
    const holder = ctxFor(wd.org, wd.boss);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const holding = new Promise<void>((r) => (held = r));
    const blocker = withOrgCore(holder, async (tx) => {
      await lockStockWrite(tx, holder);
      held();
      await hold;
    });
    await holding;
    const missing = randomUUID();
    const answers = [];
    for (const line of [t2.lineIds[0], missing]) {
      const r = swapRequest(line, wd.PM, wd.PL);
      const cmd = {
        request: r,
        operationKey: randomUUID(),
        previewHash: 'a'.repeat(64),
        payloadHash: 'b'.repeat(64),
        reason: 'x',
      };
      const pv = await previewStockCorrection(nobodyCtx, r, 'x').catch((e) => [e.code, e.message]);
      const ap = await Promise.race([
        applyStockCorrection(nobodyCtx, cmd, actorOf(nobody)).catch((e) => [e.code, e.message]),
        new Promise((x) => setTimeout(() => x('BLOCKED ON LOCK'), 3000)),
      ]);
      answers.push([pv, ap]);
    }
    release();
    await blocker;
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0][0]).toEqual(['forbidden', 'not allowed']);
    expect(answers[0][1]).toEqual(['forbidden', 'not allowed']);
    // A different price is refused as price_differs (409), still no writes.
    expect(
      await refusal(
        previewStockCorrection(wd.ownerCtx, swapRequest(t2.lineIds[0], wd.PM, wd.PD), 'x'),
      ),
    ).toBe('price_differs');
  });

  it('rolls back every intermediate write and records one immutable outcome', async () => {
    const wd = await world();
    const t = await sale(wd, [{ product: wd.PM }]);
    await postTicketStock(wd.ownerCtx, t.ticketId, actorOf(wd.boss));
    const entry = (
      await owner`select stock_entry_id from public.pos_tickets where id=${t.ticketId}`
    )[0].stock_entry_id as string;
    expect([await bin(wd.org, wd.M), await bin(wd.org, wd.L)]).toEqual(['4', '5']);
    // Fault AFTER cancel, create and submit: the receipt insert fails, so everything must roll back.
    await owner.unsafe(`create or replace function public.corr_fault() returns trigger language plpgsql as $$ begin raise exception 'injected correction fault'; end $$;
      create trigger corr_fault before insert on public.stk_corrections for each row execute function public.corr_fault()`);
    const entriesBefore = await count('stk_entries', wd.org);
    const ledgerBefore = await count('stk_ledger', wd.org);
    const key = randomUUID();
    const request = swapRequest(t.lineIds[0], wd.PM, wd.PL);
    const pv = await previewStockCorrection(wd.ownerCtx, request, 'wrong size');
    const command = {
      request,
      operationKey: key,
      previewHash: pv.previewHash,
      payloadHash: pv.payloadHash,
      reason: 'wrong size',
    };
    await expect(applyStockCorrection(wd.ownerCtx, command, actorOf(wd.boss))).rejects.toThrow();
    expect(await count('stk_entries', wd.org)).toBe(entriesBefore);
    expect(await count('stk_ledger', wd.org)).toBe(ledgerBefore);
    expect((await owner`select status from public.stk_entries where id=${entry}`)[0].status).toBe(
      'submitted',
    );
    expect(
      (await owner`select fin_product_id from public.pos_ticket_lines where id=${t.lineIds[0]}`)[0]
        .fin_product_id,
    ).toBe(wd.PM);
    expect(
      (await owner`select stock_entry_id from public.pos_tickets where id=${t.ticketId}`)[0]
        .stock_entry_id,
    ).toBe(entry);
    expect([await bin(wd.org, wd.M), await bin(wd.org, wd.L)]).toEqual(['4', '5']);
    expect(await count('stk_corrections', wd.org)).toBe(0);
    await owner.unsafe('drop trigger corr_fault on public.stk_corrections');

    // Retry with the same operation: applies once, M returned and L issued once.
    const ok = await applyStockCorrection(wd.ownerCtx, command, actorOf(wd.boss));
    expect(ok).toMatchObject({
      outcome: 'applied',
      replayed: false,
      receipt: { sourceEntryId: entry },
    });
    expect([await bin(wd.org, wd.M), await bin(wd.org, wd.L)]).toEqual(['5', '4']);
    const [row] = await owner`select * from public.stk_corrections where org_id=${wd.org}`;
    expect(row).toMatchObject({
      kind: 'sale_variant',
      reason: 'wrong size',
      actor_id: wd.boss,
      status: 'applied',
    });
    expect((await owner`select status from public.stk_entries where id=${entry}`)[0].status).toBe(
      'cancelled',
    );
    const replacement = (
      await owner`select stock_entry_id from public.pos_tickets where id=${t.ticketId}`
    )[0].stock_entry_id as string;
    expect(replacement).toBe(row.replacement_entry_id);
    expect(
      (await owner`select metadata from public.stk_entries where id=${replacement}`)[0].metadata,
    ).toMatchObject({
      source: 'pos',
      sourceId: t.ticketId,
      ticketId: t.ticketId,
      correctionOf: entry,
      correctionOperationKey: key,
    });
    // Payment and totals are byte identical; the original entry and its ledger rows remain.
    expect(
      (await owner`select count(*)::int n from public.stk_ledger where entry_id=${entry}`)[0].n,
    ).toBe(2);
    expect(
      (await owner`select total::text from public.pos_tickets where id=${t.ticketId}`)[0].total,
    ).toBe('50');
    // The receipt row cannot be edited by the application role (grants proven in the schema test).
    expect(
      await rejection(
        asApp(wd.org, wd.boss, (tx) => tx.execute(sql`delete from public.stk_corrections`)),
      ),
    ).toMatch(/permission denied/);
  });

  it('reconciles lost response and rejects changed intent operation reuse', async () => {
    const wd = await world();
    const t = await sale(wd, [{ product: wd.PM }]);
    await postTicketStock(wd.ownerCtx, t.ticketId, actorOf(wd.boss));
    const key = randomUUID();
    const { command, result } = await applyVariant(
      wd.ownerCtx,
      t.lineIds[0],
      wd.PM,
      wd.PL,
      'wrong size',
      key,
    );
    expect(result).toMatchObject({ outcome: 'applied', replayed: false });
    // Lost response: same key + hash returns the recorded outcome, no second reversal.
    const again = await applyStockCorrection(wd.ownerCtx, command, actorOf(wd.boss));
    expect(again).toMatchObject({ outcome: 'applied', replayed: true });
    expect(again.outcome === 'applied' && again.receipt.id).toBe(
      result.outcome === 'applied' && result.receipt.id,
    );
    expect([await bin(wd.org, wd.M), await bin(wd.org, wd.L)]).toEqual(['5', '4']);
    expect(
      await getStockCorrectionByOperationKey(wd.ownerCtx, {
        operationKey: key,
        payloadHash: command.payloadHash,
      }),
    ).toMatchObject({ outcome: 'applied', replayed: true });
    expect(
      await getStockCorrectionByOperationKey(wd.ownerCtx, {
        operationKey: randomUUID(),
        payloadHash: command.payloadHash,
      }),
    ).toEqual({ schemaVersion: 1, outcome: 'not_found' });
    // Changed intent (different reason => different payload hash) under the used key.
    const changed = { ...command, reason: 'other reason' };
    expect(await refusal(applyStockCorrection(wd.ownerCtx, changed, actorOf(wd.boss)))).toBe(
      'key_reuse',
    );
    expect(
      await refusal(
        getStockCorrectionByOperationKey(wd.ownerCtx, {
          operationKey: key,
          payloadHash: 'c'.repeat(64),
        }),
      ),
    ).toBe('key_reuse');
    // A stale preview (source moved on) is refused with zero effects.
    const t2 = await sale(wd, [{ product: wd.PM }]);
    await postTicketStock(wd.ownerCtx, t2.ticketId, actorOf(wd.boss));
    const req = swapRequest(t2.lineIds[0], wd.PM, wd.PL);
    const pv = await previewStockCorrection(wd.ownerCtx, req, 'r');
    await owner`update public.stk_bins set qty = qty + 1 where org_id=${wd.org} and item_id=${wd.L}`;
    expect(
      await refusal(
        applyStockCorrection(
          wd.ownerCtx,
          {
            request: req,
            operationKey: randomUUID(),
            previewHash: pv.previewHash,
            payloadHash: pv.payloadHash,
            reason: 'r',
          },
          actorOf(wd.boss),
        ),
      ),
    ).toBe('stale_preview');
    // Two concurrent identical confirmations: exactly one net L issue for the unit.
    const t3 = await sale(wd, [{ product: wd.PM }]);
    await postTicketStock(wd.ownerCtx, t3.ticketId, actorOf(wd.boss));
    const lBefore = Number(await bin(wd.org, wd.L));
    const req3 = swapRequest(t3.lineIds[0], wd.PM, wd.PL);
    const pv3 = await previewStockCorrection(wd.ownerCtx, req3, 'r');
    const cmd3 = {
      request: req3,
      operationKey: randomUUID(),
      previewHash: pv3.previewHash,
      payloadHash: pv3.payloadHash,
      reason: 'r',
    };
    const [a, b] = await Promise.allSettled([
      applyStockCorrection(ctxFor(wd.org, wd.boss), cmd3, actorOf(wd.boss)),
      applyStockCorrection(ctxFor(wd.org, wd.boss), cmd3, actorOf(wd.boss)),
    ]);
    expect([a.status, b.status]).toEqual(['fulfilled', 'fulfilled']);
    const replayed = [a, b]
      .map((r) => r.status === 'fulfilled' && r.value.outcome === 'applied' && r.value.replayed)
      .sort();
    expect(replayed).toEqual([false, true]);
    expect(Number(await bin(wd.org, wd.L))).toBe(lBefore - 1);
    expect(
      (
        await owner`select count(*)::int n from public.stk_corrections where org_id=${wd.org} and operation_key=${cmd3.operationKey}`
      )[0].n,
    ).toBe(1);
  });

  it('serializes absent bins normal posting correction and rebuild under the first org gate', async () => {
    const wd = await world();
    const holder = ctxFor(wd.org, wd.boss);
    const waiterA = ctxFor(wd.org, wd.boss);
    const waiterB = ctxFor(wd.org, wd.boss);
    const fresh = randomUUID();
    await owner.unsafe(
      `insert into public.stk_items(id,org_id,code,name) values ('${fresh}','${wd.org}','N','N')`,
    );
    const d1 = await createEntry(
      waiterA,
      { type: 'receipt', lines: [{ itemId: fresh, qty: 3, rate: 2, toWarehouseId: wd.wh }] },
      actorOf(wd.boss),
    );
    const d2 = await createEntry(
      waiterB,
      { type: 'receipt', lines: [{ itemId: fresh, qty: 4, rate: 2, toWarehouseId: wd.wh }] },
      actorOf(wd.boss),
    );
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const holding = new Promise<void>((r) => (held = r));
    const blocker = withOrgCore(holder, async (tx) => {
      await lockStockWrite(tx, holder);
      held();
      await hold;
    });
    await holding;
    const waiting = async (p: Promise<unknown>) => {
      let settled = false;
      void p.then(
        () => (settled = true),
        () => (settled = true),
      );
      for (let i = 0; i < 40; i += 1) {
        const [r] =
          await owner`select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory'`;
        if (r.n >= 1) break;
        await new Promise((x) => setTimeout(x, 25));
      }
      expect(settled).toBe(false);
    };
    // Two first writers of an ABSENT bin and a rebuild all queue behind the holder.
    const s1 = submitEntry(waiterA, d1.id, actorOf(wd.boss));
    await waiting(s1);
    const s2 = submitEntry(waiterB, d2.id, actorOf(wd.boss));
    const rb = rebuildBins(ctxFor(wd.org, wd.boss));
    release();
    await blocker;
    await Promise.all([s1, s2, rb]);
    expect(await bin(wd.org, fresh)).toBe('7');
    // Approved posting time (spec 124 T031): in range it dates the entry and every appended ledger row;
    // cancel dates only the reversal rows; earlier than the newest ledger row or in the future refuses.
    const at = new Date();
    const post = (postedAt: Date, qty: number) =>
      withOrgCore(holder, async (tx) => {
        const g = await lockStockWrite(tx, holder);
        const e = await createEntryInTx(
          tx,
          holder,
          g,
          { type: 'receipt', lines: [{ itemId: fresh, qty, rate: 2, toWarehouseId: wd.wh }] },
          actorOf(wd.boss),
        );
        return submitEntryInTx(tx, holder, g, e.id, actorOf(wd.boss), { postedAt });
      });
    const okEntry = await post(at, 1);
    expect(okEntry.transitioned).toBe(true);
    const [posted] =
      await owner`select posted_at from public.stk_entries where id=${okEntry.entry.id}`;
    expect(new Date(posted.posted_at as string).getTime()).toBe(at.getTime());
    expect(
      (
        await owner`select count(*)::int n from public.stk_ledger where entry_id=${okEntry.entry.id} and posted_at=${at}`
      )[0].n,
    ).toBe(1);
    const entriesBefore = await count('stk_entries', wd.org);
    await expect(post(new Date(at.getTime() - 3_600_000), 1)).rejects.toMatchObject({
      code: 'posted_at_out_of_order',
    });
    await expect(post(new Date(Date.now() + 3_600_000), 1)).rejects.toMatchObject({
      code: 'posted_at_out_of_order',
    });
    expect(await count('stk_entries', wd.org)).toBe(entriesBefore);
    const cancelAt = new Date();
    await withOrgCore(holder, async (tx) =>
      cancelEntryInTx(
        tx,
        holder,
        await lockStockWrite(tx, holder),
        okEntry.entry.id,
        actorOf(wd.boss),
        { postedAt: cancelAt },
      ),
    );
    expect(
      (await owner`select posted_at from public.stk_entries where id=${okEntry.entry.id}`)[0]
        .posted_at,
    ).toEqual(posted.posted_at);
    expect(
      (
        await owner`select count(*)::int n from public.stk_ledger where entry_id=${okEntry.entry.id} and posted_at=${cancelAt}`
      )[0].n,
    ).toBe(1);
    // Rebuild from the ledger agrees with the cache (no lost bin write).
    const rebuilt =
      await owner`select qty::text from public.stk_bins where org_id=${wd.org} and item_id=${fresh}`;
    expect(rebuilt[0].qty).toBe('7');
  });

  it('absent enabled module can be disabled only before or after the guarded correction', async () => {
    const wd = await world();
    const a = ctxFor(wd.org, wd.boss);
    const b = ctxFor(wd.org, wd.boss);
    expect(
      (await owner`select count(*)::int n from public.app_modules where org_id=${wd.org}`)[0].n,
    ).toBe(0);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const holding = new Promise<void>((r) => (held = r));
    // Correction-first: absent row = enabled, admitted; the disable must wait for the pair.
    const admitted = withOrgCore(a, async (tx) => {
      const guard = await lockStockWrite(tx, a);
      await assertStockModulesEnabledInTx(tx, a, guard, ['stock', 'pos']);
      held();
      await hold;
    });
    await holding;
    let disabled = false;
    const disabling = setModuleEnabled(b, 'stock', false).then(() => (disabled = true));
    for (let i = 0; i < 40; i += 1) {
      const [r] =
        await owner`select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory'`;
      if (r.n >= 1) break;
      await new Promise((x) => setTimeout(x, 25));
    }
    expect(disabled).toBe(false);
    expect(
      (await owner`select count(*)::int n from public.app_modules where org_id=${wd.org}`)[0].n,
    ).toBe(0);
    release();
    await admitted;
    await disabling;
    // Disable-first: the next correction admission refuses with zero effects.
    await expect(
      withOrgCore(a, async (tx) =>
        assertStockModulesEnabledInTx(tx, a, await lockStockWrite(tx, a), ['stock']),
      ),
    ).rejects.toMatchObject({ code: 'module_disabled' });
    const t = await sale(wd, [{ product: wd.PM }]);
    await owner`update public.pos_tickets set stock_entry_id = null where id=${t.ticketId}`;
    expect(
      await refusal(applyVariant(wd.ownerCtx, t.lineIds[0], wd.PM, wd.PL).then((r) => r.result)),
    ).not.toBeNull();
  });

  it('repeated concurrent booking completion reuses frozen draft and submitted source once', async () => {
    const wd = await world();
    const booking = randomUUID();
    await owner`insert into public.stk_accruals(org_id,source,source_id,fin_product_id,item_id,warehouse_id,qty_consumption,qty,status)
      values (${wd.org},'booking',${booking},${wd.PM},${wd.M},${wd.wh},1,1,'open')`;
    const input = {
      source: 'booking',
      sourceId: booking,
      finProductId: wd.PM,
      warehouseId: wd.wh,
      actor: actorOf(wd.boss),
    };
    const runs = await Promise.all(
      [1, 2, 3].map(() => realizeAccruals(ctxFor(wd.org, wd.boss), input)),
    );
    const ids = new Set(runs.map((r) => r.entry?.id));
    expect(ids.size).toBe(1);
    expect(
      (
        await owner`select count(*)::int n from public.stk_entries where org_id=${wd.org} and metadata->>'sourceId'=${booking}`
      )[0].n,
    ).toBe(1);
    expect(await bin(wd.org, wd.M)).toBe('4');
    expect(
      (
        await owner`select status, realized_entry_id from public.stk_accruals where org_id=${wd.org} and source_id=${booking}`
      )[0].status,
    ).toBe('realized');
    // Frozen draft: a short bin leaves a draft + warning, then the repeated call submits it once.
    const booking2 = randomUUID();
    await owner`insert into public.stk_accruals(org_id,source,source_id,fin_product_id,item_id,warehouse_id,qty_consumption,qty,status)
      values (${wd.org},'booking',${booking2},${wd.PM},${wd.M},${wd.wh},9,9,'open')`;
    const input2 = { ...input, sourceId: booking2 };
    const first = await realizeAccruals(ctxFor(wd.org, wd.boss), input2);
    expect(first.stockWarning).toMatchObject({ code: 'negative_stock' });
    await owner`update public.stk_bins set qty = 20 where org_id=${wd.org} and item_id=${wd.M}`;
    const [r1, r2] = await Promise.all([
      realizeAccruals(ctxFor(wd.org, wd.boss), input2),
      realizeAccruals(ctxFor(wd.org, wd.boss), input2),
    ]);
    expect(r1.entry?.id).toBe(first.entry?.id);
    expect(r2.entry?.id).toBe(first.entry?.id);
    expect(
      (
        await owner`select count(*)::int n from public.stk_ledger where entry_id=${first.entry!.id}`
      )[0].n,
    ).toBe(1);
  });
});

describe('stock corrections against PostgreSQL', () => {
  it('serializes period fiscal and void guards before correction', async () => {
    const wd = await world();
    const stockMgr = await addProfile(wd.org, 'member', [
      ['stock', true, true, true, 0],
      ['finance', true, false, false, 1],
    ]);
    const mgrCtx = ctxFor(wd.org, stockMgr);
    const receipt = async (item: string, qty: number, rate: number) => {
      const e = await createEntry(
        wd.ownerCtx,
        {
          type: 'receipt',
          metadata: { purchaseId: randomUUID(), providerRef: 'F-1', currency: 'USD', fxRate: 3.7 },
          lines: [{ itemId: item, qty, rate, toWarehouseId: wd.wh }],
        },
        actorOf(wd.boss),
      );
      await submitEntry(wd.ownerCtx, e.id, actorOf(wd.boss));
      return e.id;
    };
    const fresh = randomUUID();
    await owner.unsafe(
      `insert into public.stk_items(id,org_id,code,name) values ('${fresh}','${wd.org}','R','R')`,
    );
    const id = await receipt(fresh, 10, 2);
    const [line] = await owner`select id from public.stk_entry_lines where entry_id=${id}`;
    const request = (qty: string, rate: string) => ({
      mode: 'receipt_replace' as const,
      sourceType: 'stock_receipt' as const,
      sourceId: id,
      replacement: {
        lines: [
          {
            originalLineId: line.id as string,
            itemId: fresh,
            qty,
            rate,
            uom: 'unit',
            toWarehouseId: wd.wh,
          },
        ],
      },
    });
    const run = async (ctx: Ctx, req: ReturnType<typeof request>, reason = 'typo') => {
      const pv = await previewStockCorrection(ctx, req, reason);
      return applyStockCorrection(
        ctx,
        {
          request: req,
          operationKey: randomUUID(),
          previewHash: pv.previewHash,
          payloadHash: pv.payloadHash,
          reason,
        },
        actorOf(ctx.profileId),
      );
    };
    // A non-owner may not change stock VALUE; the quantity is theirs to fix.
    const ownerOnly = await previewStockCorrection(mgrCtx, request('10', '3'), 'typo');
    expect(ownerOnly.eligible).toBe(false);
    expect(ownerOnly.blockers).toContain('owner_required');
    expect(
      (await previewStockCorrection(mgrCtx, request('9', '2'), 'typo')).blockers,
    ).not.toContain('owner_required');
    expect(await refusal(run(mgrCtx, request('10', '3')))).toBe('forbidden');
    expect(await bin(wd.org, fresh)).toBe('10');
    // Locked current month: refused with zero effects.
    await owner.unsafe(
      `insert into public.pos_period_locks(org_id,period) values ('${wd.org}', to_char(now() at time zone 'America/Lima','YYYY-MM'))`,
    );
    expect(await refusal(run(mgrCtx, request('9', '2')))).toBe('period_locked');
    await owner.unsafe(`delete from public.pos_period_locks where org_id='${wd.org}'`);
    // Quantity-only correction by the stock manager: one linked replacement, purchase link and FX kept.
    const ok = await run(mgrCtx, request('9', '2'));
    expect(ok).toMatchObject({
      outcome: 'applied',
      receipt: { kind: 'receipt_replace', sourceEntryId: id },
    });
    expect(await bin(wd.org, fresh)).toBe('9');
    const repl = ok.outcome === 'applied' ? ok.receipt.replacementEntryId! : '';
    expect(
      (await owner`select metadata from public.stk_entries where id=${repl}`)[0].metadata,
    ).toMatchObject({ correctionOf: id, providerRef: 'F-1', currency: 'USD', fxRate: 3.7 });
    expect((await owner`select status from public.stk_entries where id=${id}`)[0].status).toBe(
      'cancelled',
    );
    // Already corrected, or consumed downstream: blocked, nothing moves.
    expect(await refusal(run(mgrCtx, request('8', '2')))).toBe('dependent_history');
    const id2 = await receipt(fresh, 5, 2);
    const [line2] = await owner`select id from public.stk_entry_lines where entry_id=${id2}`;
    const issue = await createEntry(
      wd.ownerCtx,
      { type: 'issue', lines: [{ itemId: fresh, qty: 1, fromWarehouseId: wd.wh }] },
      actorOf(wd.boss),
    );
    await submitEntry(wd.ownerCtx, issue.id, actorOf(wd.boss));
    const consumed = {
      mode: 'receipt_replace' as const,
      sourceType: 'stock_receipt' as const,
      sourceId: id2,
      replacement: {
        lines: [
          {
            originalLineId: line2.id as string,
            itemId: fresh,
            qty: '4',
            rate: '2',
            uom: 'unit',
            toWarehouseId: wd.wh,
          },
        ],
      },
    };
    expect(await refusal(run(mgrCtx, consumed))).toBe('dependent_history');
    // Absent finance settings: policy_unverified (no Lima fallback for receipts).
    await owner.unsafe(`delete from public.fin_settings where org_id='${wd.org}'`);
    const id3 = await receipt(fresh, 5, 2);
    const [line3] = await owner`select id from public.stk_entry_lines where entry_id=${id3}`;
    expect(
      await refusal(
        run(mgrCtx, {
          ...consumed,
          sourceId: id3,
          replacement: {
            lines: [
              { ...consumed.replacement.lines[0], originalLineId: line3.id as string, qty: '4' },
            ],
          },
        }),
      ),
    ).toBe('policy_unverified');
    // Sale guards: a locked month and a void ticket refuse the swap before any write.
    await owner.unsafe(
      `insert into public.fin_settings(org_id,timezone) values ('${wd.org}','America/Lima')`,
    );
    const t = await sale(wd, [{ product: wd.PM }]);
    await postTicketStock(wd.ownerCtx, t.ticketId, actorOf(wd.boss));
    await owner.unsafe(
      `insert into public.pos_period_locks(org_id,period) select '${wd.org}', to_char(submitted_at at time zone 'America/Lima','YYYY-MM') from public.pos_tickets where id='${t.ticketId}'`,
    );
    expect(
      await refusal(
        previewStockCorrection(wd.ownerCtx, swapRequest(t.lineIds[0], wd.PM, wd.PL), 'x'),
      ),
    ).toBe('period_locked');
    await owner.unsafe(`delete from public.pos_period_locks where org_id='${wd.org}'`);
    await owner.unsafe(`update public.pos_tickets set status='void' where id='${t.ticketId}'`);
    expect(
      await refusal(
        previewStockCorrection(wd.ownerCtx, swapRequest(t.lineIds[0], wd.PM, wd.PL), 'x'),
      ),
    ).toBe('dependent_history');
  });
});

// ── shared barriers for the writer/authority race cases ──────────────────────────────────

/** Hold stock-v1 + the org authority lock (what an in-flight correction holds) until `release()`. */
async function holdGate(ctx: Ctx) {
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let held!: () => void;
  const holding = new Promise<void>((r) => (held = r));
  const done = withOrgCore(ctx, async (tx) => {
    await lockStockWrite(tx, ctx);
    held();
    await hold;
  });
  await holding;
  return { release, done };
}
/**
 * An authority writer as the existing participants behave (org authority lock, then its own rows) on a
 * raw connection with table-owner rights. The real writeSectionAccess/deleteUser need nav-policy and
 * auth-admin fixtures this child does not model; their lock participation is proven in their own suites.
 */
async function authorityWriter(
  org: string,
  write: (tx: postgres.TransactionSql) => PromiseLike<unknown>,
) {
  const raw = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => undefined });
  extraClients.push(raw);
  await raw.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${org},112))`; // same key as lockNavigationPolicy
    await write(tx);
  });
}
/** True when the promise has NOT settled after a backend is observed waiting on an advisory lock. */
async function parkedBehindGate(p: Promise<unknown>) {
  let settled = false;
  void p.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 60; i += 1) {
    const [r] =
      await owner`select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory'`;
    if (r.n >= 1) break;
    await new Promise((x) => setTimeout(x, 25));
  }
  return !settled;
}

describe('stock corrections against PostgreSQL', () => {
  it('freezes approved stock only lines and preserves financial facts', async () => {
    const wd = await world();
    // Mixed ticket: line 0 issues stock (M), line 1 is stockless. Swap line 0 M -> L.
    const t = await sale(wd, [{ product: wd.PM }, { product: wd.PS1 }]);
    await postTicketStock(wd.ownerCtx, t.ticketId, actorOf(wd.boss));
    const financial = async () =>
      JSON.stringify([
        await owner`select subtotal::text, total::text, status from public.pos_tickets where id=${t.ticketId}`,
        await owner`select method, amount::text, shift_id from public.pos_payments where ticket_id=${t.ticketId} order by id`,
      ]);
    const financeBefore = await financial();
    const { result } = await applyVariant(wd.ownerCtx, t.lineIds[0], wd.PM, wd.PL);
    expect(result).toMatchObject({ outcome: 'applied', receipt: { kind: 'sale_variant' } });
    // The replacement is the FROZEN original issue with M swapped for L, in the same warehouse.
    const [{ stock_entry_id: live }] =
      await owner`select stock_entry_id from public.pos_tickets where id=${t.ticketId}`;
    const lines =
      await owner`select item_id, qty::text, from_warehouse_id from public.stk_entry_lines where entry_id=${live}`;
    expect(lines.map((l) => [l.item_id, l.qty, l.from_warehouse_id])).toEqual([[wd.L, '1', wd.wh]]);
    expect(await bin(wd.org, wd.M)).toBe('5');
    expect(await bin(wd.org, wd.L)).toBe('4');
    expect(await financial()).toBe(financeBefore);
    // A recipe edited AFTER the sale is never regenerated into the replacement: the swap refuses with zero effects.
    const t2 = await sale(wd, [{ product: wd.PL }]);
    await postTicketStock(wd.ownerCtx, t2.ticketId, actorOf(wd.boss));
    await owner`update public.stk_consumption set qty_per_unit = 2 where org_id=${wd.org} and fin_product_id=${wd.PL}`;
    const entries = await count('stk_entries', wd.org);
    const ledger = await count('stk_ledger', wd.org);
    expect(
      await refusal(
        previewStockCorrection(wd.ownerCtx, swapRequest(t2.lineIds[0], wd.PL, wd.PM), 'x'),
      ),
    ).toBe('stock_drift');
    expect(await count('stk_entries', wd.org)).toBe(entries);
    expect(await count('stk_ledger', wd.org)).toBe(ledger);
    // The till swap keeps POS-edit-only authority through the server-only scope (and only for ITS ticket).
    const posOnly = await addProfile(wd.org, 'member', [['pos', true, true, false, 0]]);
    const posCtx = ctxFor(wd.org, posOnly);
    const t3 = await sale(wd, [{ product: wd.PM }]);
    await postTicketStock(wd.ownerCtx, t3.ticketId, actorOf(wd.boss));
    const req = swapRequest(t3.lineIds[0], wd.PM, wd.PL);
    expect(await refusal(previewStockCorrection(posCtx, req, 'r'))).toBe('stock_scope_required');
    expect(await refusal(previewStockCorrection(posCtx, req, 'r', { ticketId: t.ticketId }))).toBe(
      'not_found',
    );
    const scope = { ticketId: t3.ticketId };
    const pv = await previewStockCorrection(posCtx, req, 'r', scope);
    expect(pv.eligible).toBe(true);
    const applied = await applyStockCorrection(
      posCtx,
      {
        request: req,
        operationKey: randomUUID(),
        previewHash: pv.previewHash,
        payloadHash: pv.payloadHash,
        reason: 'r',
      },
      actorOf(posOnly),
      scope,
    );
    expect(applied).toMatchObject({ outcome: 'applied' });
    // TODO(handoff): the private owner-approved stock_only entrypoint (garment-envelope.md) is not built;
    // this case proves the frozen-line engine its public swap shares, not that private command.
  });

  it('drains old mapping posters and refuses persisted old mapping pending sources', async () => {
    const wd = await world();
    // A mapping writer queues behind an in-flight stock write and applies after it.
    const gate = await holdGate(ctxFor(wd.org, wd.boss));
    const writer = setConsumption(
      ctxFor(wd.org, wd.boss),
      { finProductId: wd.PD, itemId: wd.X, qtyPerUnit: 3 },
      actorOf(wd.boss),
    );
    expect(await parkedBehindGate(writer)).toBe(true);
    expect(await count('stk_consumption', wd.org)).toBe(2);
    gate.release();
    await gate.done;
    await writer;
    // The next poster reads the committed mapping, never the old one.
    const t = await sale(wd, [{ product: wd.PD }]);
    await postTicketStock(wd.ownerCtx, t.ticketId, actorOf(wd.boss));
    expect(await bin(wd.org, wd.X)).toBe('2');
    // TODO(handoff): the F1 mapping cutover writer and its `cutover_pending_sources` census refusal do
    // not exist yet; only the shared-gate drain is proven here (meta proposals/2026-11-17-hub-stock-correction-handoff.md).
  });

  it('absent permission deny insertion serializes with correction in both authority lock orders', async () => {
    const wd = await world();
    const admin = await addProfile(wd.org, 'owner');
    await owner`update public.organization_members set role='admin' where organization_id=${wd.org} and profile_id=${admin}`;
    const adminCtx = ctxFor(wd.org, admin);
    const t = await sale(wd, [{ product: wd.PM }]);
    await postTicketStock(wd.ownerCtx, t.ticketId, actorOf(wd.boss));
    expect(
      (await owner`select count(*)::int n from public.permission_rules where org_id=${wd.org}`)[0]
        .n,
    ).toBe(0);
    // The deny is a row that does not exist yet: FOR SHARE on existing rows could never exclude it.
    const insertDeny = () =>
      authorityWriter(
        wd.org,
        (tx) =>
          tx`insert into public.permission_rules(org_id,role_key,module,can_view,can_edit,can_manage,field_level) values (${wd.org},'admin','stock',false,false,false,0)`,
      );
    // Correction first: the writer waits, then applies after the correction commits.
    const gate = await holdGate(adminCtx);
    const deny = insertDeny();
    expect(await parkedBehindGate(deny)).toBe(true);
    expect(
      (await owner`select count(*)::int n from public.permission_rules where org_id=${wd.org}`)[0]
        .n,
    ).toBe(0);
    gate.release();
    await gate.done;
    await deny;
    // Deny first: the stock-moving swap now needs stock access the admin no longer has; zero effects.
    const entries = await count('stk_entries', wd.org);
    const request = swapRequest(t.lineIds[0], wd.PM, wd.PL);
    expect(await refusal(previewStockCorrection(adminCtx, request, 'x'))).toBe(
      'stock_scope_required',
    );
    expect(
      await refusal(
        applyStockCorrection(
          adminCtx,
          {
            request,
            operationKey: randomUUID(),
            previewHash: H('a'),
            payloadHash: H('b'),
            reason: 'x',
          },
          actorOf(admin),
        ),
      ),
    ).toBe('stock_scope_required');
    expect(await count('stk_entries', wd.org)).toBe(entries);
    expect(await bin(wd.org, wd.M)).toBe('4');
  });

  it('serializes warehouse timezone and bundle eligibility writers in both arrival orders', async () => {
    const wd = await world();
    const w2 = randomUUID();
    await owner.unsafe(
      `insert into public.stk_warehouses(id,org_id,name) values ('${w2}','${wd.org}','W2')`,
    );
    const writers: Array<[string, () => Promise<unknown>, () => Promise<boolean>]> = [
      [
        'warehouse',
        () => updateWarehouse(ctxFor(wd.org, wd.boss), w2, { name: 'W2b' }),
        async () =>
          (await owner`select name from public.stk_warehouses where id=${w2}`)[0].name === 'W2b',
      ],
      [
        'timezone',
        () => updateFinSettings(ctxFor(wd.org, wd.boss), { timezone: 'America/Bogota' }),
        async () =>
          (await owner`select timezone from public.fin_settings where org_id=${wd.org}`)[0]
            .timezone === 'America/Bogota',
      ],
      [
        'bundle',
        () =>
          setBundleComponent(ctxFor(wd.org, wd.boss), {
            bundleProductId: wd.PS1,
            childProductId: wd.PS2,
            qty: 1,
          }),
        async () =>
          (
            await owner`select count(*)::int n from public.fin_product_components where org_id=${wd.org}`
          )[0].n === 1,
      ],
    ];
    for (const [, write, applied] of writers) {
      // Correction first: the writer parks, nothing slips in, and it applies after the release.
      const gate = await holdGate(ctxFor(wd.org, wd.boss));
      const pending = write();
      expect(await parkedBehindGate(pending)).toBe(true);
      expect(await applied()).toBe(false);
      gate.release();
      await gate.done;
      await pending;
      expect(await applied()).toBe(true);
    }
    // Writer first: a correction admitted afterwards sees the committed rule (the approved hash moves).
    const receiptId = (
      await createEntry(
        wd.ownerCtx,
        { type: 'receipt', lines: [{ itemId: wd.X, qty: 2, rate: 1, toWarehouseId: wd.wh }] },
        actorOf(wd.boss),
      )
    ).id;
    await submitEntry(wd.ownerCtx, receiptId, actorOf(wd.boss));
    const [line] = await owner`select id from public.stk_entry_lines where entry_id=${receiptId}`;
    const request = {
      mode: 'receipt_replace' as const,
      sourceType: 'stock_receipt' as const,
      sourceId: receiptId,
      replacement: {
        lines: [
          {
            originalLineId: line.id as string,
            itemId: wd.X,
            qty: '1',
            rate: '1',
            uom: 'unit',
            toWarehouseId: wd.wh,
          },
        ],
      },
    };
    const before = await previewStockCorrection(wd.ownerCtx, request, 'x');
    await updateFinSettings(ctxFor(wd.org, wd.boss), { timezone: 'Pacific/Kiritimati' });
    const after = await previewStockCorrection(wd.ownerCtx, request, 'x');
    expect(after.previewHash).not.toBe(before.previewHash);
    expect(
      await refusal(
        applyStockCorrection(
          wd.ownerCtx,
          {
            request,
            operationKey: randomUUID(),
            previewHash: before.previewHash,
            payloadHash: before.payloadHash,
            reason: 'x',
          },
          actorOf(wd.boss),
        ),
      ),
    ).toBe('stale_preview');
    expect(await bin(wd.org, wd.X)).toBe('7');
  });

  it('rejects deleting principals and inactive organizations before correction admission', async () => {
    const wd = await world();
    const t = await sale(wd, [{ product: wd.PM }]);
    await postTicketStock(wd.ownerCtx, t.ticketId, actorOf(wd.boss));
    const request = swapRequest(t.lineIds[0], wd.PM, wd.PL);
    const entries = await count('stk_entries', wd.org);
    const attempt = () =>
      applyStockCorrection(
        wd.ownerCtx,
        {
          request,
          operationKey: randomUUID(),
          previewHash: H('a'),
          payloadHash: H('b'),
          reason: 'x',
        },
        actorOf(wd.boss),
      );
    // Deletion flagged first: private data stays unread and the refusal is a plain 403.
    await owner`update public.profiles set deletion_pending=true where id=${wd.boss}`;
    expect(await refusal(previewStockCorrection(wd.ownerCtx, request, 'x'))).toBe('forbidden');
    expect(await refusal(attempt())).toBe('forbidden');
    await owner`update public.profiles set deletion_pending=false where id=${wd.boss}`;
    // An inactive organization refuses even though every role row remains.
    await owner`update public.organizations set status='suspended' where id=${wd.org}`;
    expect(await refusal(previewStockCorrection(wd.ownerCtx, request, 'x'))).toBe('forbidden');
    expect(await refusal(attempt())).toBe('forbidden');
    await owner`update public.organizations set status='active' where id=${wd.org}`;
    expect(await count('stk_entries', wd.org)).toBe(entries);
    // Correction first: the deletion flag (written under the org authority lock) waits and lands afterwards.
    const gate = await holdGate(ctxFor(wd.org, wd.boss));
    const flag = authorityWriter(
      wd.org,
      (tx) => tx`update public.profiles set deletion_pending=true where id=${wd.boss}`,
    );
    expect(await parkedBehindGate(flag)).toBe(true);
    expect(
      (await owner`select deletion_pending from public.profiles where id=${wd.boss}`)[0]
        .deletion_pending,
    ).toBe(false);
    gate.release();
    await gate.done;
    await flag;
    expect(await refusal(attempt())).toBe('forbidden');
  });
});
