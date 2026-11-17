import { createHash, randomUUID } from 'node:crypto';
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
import { withOrgCore } from '$server/db/with-org-core';
import { round4 } from './stock.logic';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  createEntry,
  createEntryInTx,
  lockStockWrite,
  submitEntry,
  submitEntryInTx,
} from './stock.service';
import { receiptRateBasis, type DocumentBasis } from '../../../scripts/lib/faces-receipt-replay';
import {
  ReceiptCorrectionError,
  receiptManifestSha256,
  type ReceiptChainManifestV1,
} from './faces-receipt-correction.logic';
import {
  applyReceiptCorrection,
  draftReceiptCompensationManifest,
  draftReceiptCorrectionManifest,
  getReceiptCorrectionStatus,
  previewReceiptCorrection,
} from './faces-receipt-correction.service';
import {
  openCorrectionNativeChild,
  type CorrectionNativeChild,
} from './stock-corrections.native-setup';

/**
 * F2 native receipt-correction suite (spec 123): the ten quickstart behaviors, registered in NATIVE_POSTGRES_MANIFEST['qa-native'].
 * One owned child database, real F3 helpers, real app_ledger/RLS.
 */
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const H = (n: number) => n.toString(16).padStart(64, '0');
const SHA40 = 'a'.repeat(40);
let child: CorrectionNativeChild;
let owner: postgres.Sql;
const clients: postgres.Sql[] = [];
const actorOf = (id: string) => ({ id, name: 'Native' });
type Ctx = CoreCtx;
const ctxFor = (org: string, profile: string): Ctx => {
  const client = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => undefined });
  clients.push(client);
  return { db: drizzle(client) as unknown as CoreCtx['db'], tenantId: org, profileId: profile };
};
beforeAll(async () => {
  child = await openCorrectionNativeChild();
  owner = child.owner;
}, 240_000);
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end({ timeout: 5 }).catch(() => undefined)));
  await child?.close();
});

async function addProfile(
  org: string,
  role: 'owner' | 'member',
  rules: Array<[string, boolean, boolean, boolean, number]> = [],
) {
  const id = randomUUID();
  await owner.unsafe(`insert into auth.users(id,email) values ('${id}','${id}@fr.test')`);
  await owner.unsafe(`insert into public.profiles(id,email) values ('${id}','${id}@fr.test')`);
  await owner.unsafe(
    `insert into public.organization_members(organization_id,profile_id,role) values ('${org}','${id}','${role}')`,
  );
  if (rules.length) {
    await owner.unsafe(
      `insert into public.member_roles(org_id,profile_id,role_key) values ('${org}','${id}','custom')`,
    );
    for (const [mod, v, e, m, l] of rules)
      await owner.unsafe(
        `insert into public.permission_rules(org_id,role_key,module,can_view,can_edit,can_manage,field_level) values ('${org}','custom','${mod}',${v},${e},${m},${l})`,
      );
  }
  return id;
}

/** Opening 8 @ 250, receipt N stored at the wrong per-unit rate, then ordinary POS/booking issues each owning a consumer. */
type Opts = {
  receiptQty?: number;
  storedRate?: number;
  total?: string;
  pos?: boolean;
  booking?: number[];
};
async function world(o: Opts = {}) {
  const receiptQty = o.receiptQty ?? 89;
  const storedRate = o.storedRate ?? 5474.58;
  const total = o.total ?? '5474.58';
  const org = randomUUID();
  await owner.unsafe(
    `insert into public.organizations(id,name) values ('${org}','fr-${org.slice(0, 6)}')`,
  );
  const boss = await addProfile(org, 'owner');
  const [wh] = await owner.unsafe(
    `insert into public.stk_warehouses(org_id,name,is_default) values ('${org}','W',true) returning id`,
  );
  const [item] = await owner.unsafe(
    `insert into public.stk_items(org_id,code,name) values ('${org}','S','S') returning id`,
  );
  await owner.unsafe(
    `insert into public.fin_settings(org_id,timezone) values ('${org}','America/Lima')`,
  );
  const ctx = ctxFor(org, boss);
  const post = async (
    type: 'receipt' | 'issue',
    qty: number,
    rate: number | null,
    metadata: Record<string, unknown> = {},
  ) => {
    const e = await createEntry(
      ctx,
      {
        type,
        metadata,
        lines: [
          {
            itemId: item.id as string,
            qty,
            ...(rate === null
              ? { fromWarehouseId: wh.id as string }
              : { rate, toWarehouseId: wh.id as string }),
          },
        ],
      },
      actorOf(boss),
    );
    await submitEntry(ctx, e.id, actorOf(boss));
    return e.id;
  };
  await post('receipt', 8, 250);
  const receipt = await post('receipt', receiptQty, storedRate, { providerRef: 'F-1' });
  let posIssue = '';
  let ticket = '';
  if (o.pos ?? true) {
    const [shift] = await owner.unsafe(
      `insert into public.pos_shifts(org_id,status,opened_by) values ('${org}','open','${boss}') returning id`,
    );
    const [t] = await owner.unsafe(
      `insert into public.pos_tickets(org_id,human_id,shift_id,subtotal,total,created_by) values ('${org}','POS-${randomUUID().slice(0, 4)}','${shift.id}',50,50,'${boss}') returning id`,
    );
    await owner.unsafe(
      `insert into public.pos_payments(org_id,ticket_id,shift_id,method,amount) values ('${org}','${t.id}','${shift.id}','cash',50)`,
    );
    ticket = String(t.id);
    posIssue = await post('issue', 10, null, { source: 'pos', sourceId: ticket });
    await owner.unsafe(
      `update public.pos_tickets set stock_entry_id='${posIssue}' where id='${ticket}'`,
    );
  }
  const bookIssues: string[] = [];
  for (const q of o.booking ?? [8]) {
    const booking = randomUUID();
    const e = await post('issue', q, null, { source: 'booking', sourceId: booking });
    await owner.unsafe(
      `insert into public.stk_accruals(org_id,source,source_id,item_id,warehouse_id,qty_consumption,qty,status,realized_entry_id,realized_qty,realized_value,realized_at)
         values ('${org}','booking','${booking}','${item.id}','${wh.id}',${q},${q},'realized','${e}',${q},'1999.9999',now())`,
    );
    bookIssues.push(e);
  }
  return {
    org,
    boss,
    ctx,
    wh: String(wh.id),
    item: String(item.id),
    receipt,
    posIssue,
    bookIssue: bookIssues[0] ?? '',
    ticket,
    receiptQty,
    total,
  };
}
type World = Awaited<ReturnType<typeof world>>;

async function basisFor(w: World, chainEntryIds: string[]): Promise<DocumentBasis> {
  const rows = await owner.unsafe(
    `select e.id::text id, to_jsonb(e)::text e_text, to_jsonb(l)::text l_text, l.id::text line_id, e.type, e.metadata
       from public.stk_entries e join public.stk_entry_lines l on l.entry_id=e.id where e.id in (${chainEntryIds.map((i) => `'${i}'`).join(',')})`,
  );
  const [item] = await owner.unsafe(
    `select to_jsonb(i)::text t from public.stk_items i where id='${w.item}'`,
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const qty = String(w.receiptQty);
  const res = receiptRateBasis(w.total, qty).rateRoundingResidual;
  return {
    policy: 'verified_document_total',
    reference: 'F-001',
    sha256: H(70),
    valuationCurrency: 'PEN',
    stockQty: qty,
    totalValuation: w.total,
    fxEvidenceSha256: H(71),
    taxFreightAllocationSha256: H(72),
    roundingResidual: String(Number(res.numerator) / Number(res.denominator)),
    residualAccepted: true,
    unitQualification: {
      schemaVersion: 1,
      receiptEntryId: w.receipt,
      receiptLineId: String(byId.get(w.receipt)!.line_id),
      itemId: w.item,
      itemRowSha256: sha(String(item.t)),
      documentSha256: H(70),
      documentLineReference: 'l1',
      stockUom: 'unit',
      documentUom: 'unit',
      documentQuantity: qty,
      stockUnitsPerDocumentUnit: '1',
      historicalStockUomEvidenceSha256: H(73),
      conversionEvidenceSha256: H(74),
      verifiedByProfileId: w.boss,
      verifiedAt: new Date().toISOString(),
      sources: chainEntryIds.map((id) => {
        const r = byId.get(id)!;
        const meta = r.metadata as { source?: string; sourceId?: string };
        const kind =
          r.type === 'receipt' ? 'receipt' : meta.source === 'pos' ? 'pos_ticket' : 'booking';
        return {
          entryId: id,
          lineId: String(r.line_id),
          headerRowSha256: sha(String(r.e_text)),
          lineRowSha256: sha(String(r.l_text)),
          sourceKind: kind,
          sourceId: kind === 'receipt' ? id : String(meta.sourceId),
          writer:
            kind === 'receipt'
              ? 'receipt_stock_quantity'
              : kind === 'pos_ticket'
                ? 'pos_normalized_stock_quantity'
                : 'booking_normalized_stock_quantity',
          writerCodeSha: SHA40,
          writerEvidenceSha256: H(75),
        };
      }),
    },
  } as DocumentBasis;
}
const TARGET = { databaseIdentity: H(1), authProject: 'local', authUrl: 'http://127.0.0.1:54321' };

async function draft(
  w: World,
  over: Partial<{ operationKey: string; postedAt: string; reason: string }> = {},
): Promise<ReceiptChainManifestV1> {
  const chain = await owner.unsafe(
    `select l.entry_id::text id from public.stk_ledger l where l.org_id='${w.org}' and l.id >= (select min(id) from public.stk_ledger where entry_id='${w.receipt}') order by l.id`,
  );
  const basis = await basisFor(
    w,
    chain.map((r) => String(r.id)),
  );
  return draftReceiptCorrectionManifest(w.ctx, {
    target: TARGET,
    sourceCodeSha: SHA40,
    operationKey: over.operationKey ?? randomUUID(),
    receiptEntryId: w.receipt,
    receiptLineId: basis.unitQualification.receiptLineId,
    basis,
    postedAt: over.postedAt ?? new Date().toISOString(),
    reason: over.reason ?? 'Invoice total correction',
    ownerApprovalReference: 'owner-ok',
  });
}
const compensationDraft = (w: World, inverseOfOperationId: string) =>
  draftReceiptCompensationManifest(w.ctx, {
    target: TARGET,
    sourceCodeSha: SHA40,
    operationKey: randomUUID(),
    inverseOfOperationId,
    postedAt: new Date().toISOString(),
    reason: 'Undo the correction',
    ownerApprovalReference: 'owner-undo',
  });
const command = async (w: World, m: ReceiptChainManifestV1) => {
  const pv = await previewReceiptCorrection(w.ctx, m);
  return { manifest: m, approvedPlanSha256: receiptManifestSha256(m), previewHash: pv.previewHash };
};
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ReceiptCorrectionError) return e.code;
    throw e;
  }
  return null;
};
const count = async (table: string, org: string) =>
  Number(
    (await owner.unsafe(`select count(*)::int n from public.${table} where org_id='${org}'`))[0].n,
  );
const bin = async (w: World) =>
  (
    await owner.unsafe(
      `select qty::text qty, valuation_rate::text rate from public.stk_bins where org_id='${w.org}' and item_id='${w.item}'`,
    )
  )[0];
const statusInput = (w: World, m: ReceiptChainManifestV1) => ({
  target: m.target,
  orgId: w.org,
  actorProfileId: w.boss,
  operationKey: m.operationKey,
  action: m.action,
  manifestSha256: receiptManifestSha256(m),
  manifest: m,
});
/** Affirmative lock-wait barrier: some backend is waiting on an (advisory) lock right now. */
async function waitForLockWait(): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    const [r] = await owner.unsafe(
      `select count(*)::int n from pg_locks where locktype='advisory' and not granted`,
    );
    if (Number(r.n) > 0) return;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('lock-wait barrier never observed');
}
async function waitForSleep(): Promise<void> {
  for (let i = 0; i < 600; i += 1) {
    const [r] = await owner.unsafe(
      `select count(*)::int n from pg_stat_activity where wait_event='PgSleep'`,
    );
    if (Number(r.n) > 0) return;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('sleep barrier never observed');
}

describe('FACES receipt correction against PostgreSQL', () => {
  it('original 89 unit fixture replays opening value and all consumer costs within the declared oracle bounds', async () => {
    const w = await world();
    const m = await draft(w);
    // independent plain arithmetic: 8 @ 250, receipt 89 @ 61.5121, then 10 (POS) and 8 (booking) at the moving average
    const rate1 = (8 * 250 + 89 * 61.5121) / 97;
    const e = m.intended.effects;
    expect(e.map((x) => x.phase)).toEqual([
      'reverse_issue',
      'reverse_issue',
      'reverse_receipt',
      'receipt',
      'issue',
      'issue',
    ]);
    expect(Math.abs(Number(e[2].qtyAfter) - 8)).toBeLessThan(1e-9); // opening recovered
    expect(Math.abs(Number(e[2].valuationRate) - 250)).toBeLessThan(1e-8);
    expect(Math.abs(Number(e[3].valueDelta) - 89 * 61.5121)).toBeLessThan(1e-8);
    expect(Math.abs(Number(e[4].valueDelta) + 10 * rate1)).toBeLessThan(1e-8);
    expect(Math.abs(Number(e[5].valueDelta) + 8 * rate1)).toBeLessThan(1e-8);
    expect(m.intended.terminalQty).toBe('79');
    expect(Math.abs(Number(m.intended.terminalRate) - rate1)).toBeLessThan(1e-8);
    expect(Math.abs(Number(m.intended.terminalValue) - 79 * rate1)).toBeLessThan(1e-7);
    const acc = m.consumers.find((c) => c.kind === 'stock_accrual');
    expect(acc && acc.kind === 'stock_accrual' && acc.intendedRealizedValue).toBe(
      String(round4(8 * rate1)),
    );
    // net COGS = new issue cost - original issue cost (the wrong rate overstated COGS)
    const origRate = (8 * 250 + 89 * 5474.58) / 97;
    expect(Math.abs(Number(m.intended.netCogsDelta) - 18 * (rate1 - origRate))).toBeLessThan(1e-6);
  });

  it('fresh supported chains of up to 128 issues are admitted but a 129th issue and every unsupported shape refuse', async () => {
    // minimum: the receipt alone (zero issues)
    const zero = await world({ pos: false, booking: [] });
    const mz = await draft(zero);
    expect(mz.entries).toHaveLength(1);
    expect(
      await applyReceiptCorrection(zero.ctx, await command(zero, mz), actorOf(zero.boss)),
    ).toMatchObject({ replayed: false });
    // maximum: receipt + 128 booking issues
    const big = await world({
      receiptQty: 200,
      storedRate: 10,
      total: '1000',
      pos: false,
      booking: Array.from({ length: 128 }, () => 1),
    });
    const mb = await draft(big);
    expect(mb.entries).toHaveLength(129);
    expect(mb.intended.effects).toHaveLength(258);
    const before = await bin(big);
    await applyReceiptCorrection(big.ctx, await command(big, mb), actorOf(big.boss));
    expect(Number((await bin(big)).qty)).toBe(Number(before.qty));
    // a 129th issue refuses with zero effects
    const over = await world({
      receiptQty: 200,
      storedRate: 10,
      total: '1000',
      pos: false,
      booking: Array.from({ length: 129 }, () => 1),
    });
    const ledger = await count('stk_ledger', over.org);
    expect(await code(draft(over))).toBe('unsupported_movement');
    expect(await count('stk_ledger', over.org)).toBe(ledger);
    // second receipt, adjustment and transfer after the receipt
    for (const type of ['receipt', 'adjustment', 'transfer'] as const) {
      const w = await world();
      const [wh2] = await owner.unsafe(
        `insert into public.stk_warehouses(org_id,name) values ('${w.org}','W2') returning id`,
      );
      const line =
        type === 'transfer'
          ? { itemId: w.item, qty: 1, fromWarehouseId: w.wh, toWarehouseId: String(wh2.id) }
          : { itemId: w.item, qty: 1, rate: 5, toWarehouseId: w.wh };
      const e = await createEntry(w.ctx, { type, lines: [line] }, actorOf(w.boss));
      await submitEntry(w.ctx, e.id, actorOf(w.boss));
      expect(await code(draft(w))).toBe('unsupported_movement');
    }
  });

  it('reverse and replay commit receipt entries ledger bins consumer links and audit atomically', async () => {
    const w = await world();
    const ledgerBefore = await count('stk_ledger', w.org);
    const m = await draft(w);
    expect(m.entries).toHaveLength(3);
    expect(m.intended.receiptRate).toBe(receiptRateBasis('5474.58', '89').receiptRate);
    const before = await bin(w);
    const cmd = await command(w, m);
    const applied = await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss));
    expect(applied).toMatchObject({
      outcome: 'applied',
      replayed: false,
      receipt: { action: 'correct', sourceReceiptId: w.receipt },
    });
    const after = await bin(w);
    expect(Number(after.qty)).toBe(Number(before.qty));
    expect(String(Number(after.rate))).toBe(m.intended.terminalRate);
    expect(Number(after.rate)).toBeLessThan(Number(before.rate));
    expect(
      (await owner.unsafe(`select status from public.stk_entries where id='${w.receipt}'`))[0]
        .status,
    ).toBe('cancelled');
    expect(await count('stk_ledger', w.org)).toBe(ledgerBefore + 6);
    const repl = (
      await owner.unsafe(
        `select id::text, status, metadata, human_id from public.stk_entries where id='${m.entryMap[0].replacementEntryId}'`,
      )
    )[0];
    expect(repl.status).toBe('submitted');
    expect(repl.metadata).toMatchObject({
      correctionOf: w.receipt,
      providerRef: 'F-1',
      correctionOperationKey: m.operationKey,
    });
    expect(repl.human_id).not.toBeNull();
    expect(
      (
        await owner.unsafe(
          `select uom from public.stk_entry_lines where entry_id='${m.entryMap[0].replacementEntryId}'`,
        )
      )[0].uom,
    ).toBeNull();
    expect(
      (
        await owner.unsafe(
          `select stock_entry_id::text s, total::text t from public.pos_tickets where id='${w.ticket}'`,
        )
      )[0],
    ).toMatchObject({ s: m.entryMap[1].replacementEntryId, t: expect.stringMatching(/^50/) });
    const acc = (
      await owner.unsafe(
        `select realized_entry_id::text e, realized_value::text v, realized_qty::text q, updated_at from public.stk_accruals where org_id='${w.org}'`,
      )
    )[0];
    expect(acc.e).toBe(m.entryMap[2].replacementEntryId);
    expect(acc.q).toBe('8');
    expect(new Date(acc.updated_at as string).toISOString()).toBe(m.postedAt);
    expect(await count('stk_corrections', w.org)).toBe(1);
    expect(await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).toMatchObject({
      replayed: true,
    });
    expect(await count('stk_ledger', w.org)).toBe(ledgerBefore + 6);
    // one durable audit row on the source receipt, written in the same commit
    expect(
      Number(
        (
          await owner.unsafe(
            `select count(*)::int n from public.doc_audit_log where org_id='${w.org}' and ref_type='stk_entry' and ref_id='${w.receipt}' and changes::text like '%correction%'`,
          )
        )[0].n,
      ),
    ).toBe(1);
  });

  it('each intermediate fault rolls back and a repeated operation creates no new effects', async () => {
    const w = await world();
    const m = await draft(w);
    const cmd = await command(w, m);
    const snapshot = async () => ({
      ledger: await count('stk_ledger', w.org),
      entries: await count('stk_entries', w.org),
      bin: await bin(w),
      corrections: await count('stk_corrections', w.org),
    });
    const before = await snapshot();
    // faults after the reversals+replacements (ticket relink) and after the accrual relink
    for (const table of ['pos_tickets', 'stk_accruals']) {
      await owner.unsafe(
        `create or replace function public.fr_fault() returns trigger language plpgsql as $$ begin raise exception 'injected fault'; end $$`,
      );
      await owner.unsafe(
        `create trigger fr_fault before update on public.${table} for each row execute function public.fr_fault()`,
      );
      await expect(applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).rejects.toBeInstanceOf(
        ReceiptCorrectionError,
      );
      expect(await snapshot()).toEqual(before);
      expect(
        (await owner.unsafe(`select status from public.stk_entries where id='${w.receipt}'`))[0]
          .status,
      ).toBe('submitted');
      await owner.unsafe(`drop trigger fr_fault on public.${table}`);
    }
    // a fault while writing the immutable receipt (before the audit) also leaves nothing behind
    await owner.unsafe(
      `create or replace function public.fr_fault() returns trigger language plpgsql as $$ begin raise exception 'injected fault'; end $$`,
    );
    await owner.unsafe(
      `create trigger fr_fault before insert on public.stk_corrections for each row execute function public.fr_fault()`,
    );
    await expect(applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).rejects.toBeInstanceOf(
      ReceiptCorrectionError,
    );
    expect(await snapshot()).toEqual(before);
    await owner.unsafe(`drop trigger fr_fault on public.stk_corrections`);
    expect(await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).toMatchObject({
      replayed: false,
    });
    expect(await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).toMatchObject({
      replayed: true,
    });
    expect((await snapshot()).ledger).toBe(before.ledger + 6);
  });

  it('same key changed intent and competing source operation cannot correct twice', async () => {
    const w = await world();
    const a = await draft(w);
    const b = await draft(w);
    const [ca, cb] = [await command(w, a), await command(w, b)];
    const settled = await Promise.allSettled([
      applyReceiptCorrection(w.ctx, ca, actorOf(w.boss)),
      applyReceiptCorrection(ctxFor(w.org, w.boss), cb, actorOf(w.boss)),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ReceiptCorrectionError);
    expect(await count('stk_corrections', w.org)).toBe(1);
    // same key under changed intent
    const winner = settled[0].status === 'fulfilled' ? a : b;
    const changed = { ...winner, reason: 'a different reason' };
    expect(
      await code(
        applyReceiptCorrection(
          w.ctx,
          {
            manifest: changed,
            approvedPlanSha256: receiptManifestSha256(changed),
            previewHash: H(9),
          },
          actorOf(w.boss),
        ),
      ),
    ).toBe('key_reuse');
    // the corrected source cannot be corrected again
    expect(await code(draft(w))).toBe('unsupported_movement');
  });

  it('issue first rejects stale correction and correction first makes a waiting issue use corrected stock', async () => {
    // order A: an ordinary issue commits first while the correction waits on the gate
    const a = await world();
    const ma = await draft(a);
    const cmdA = await command(a, ma);
    const holder = ctxFor(a.org, a.boss);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const acquired = new Promise<void>((r) => (held = r));
    const blocker = withOrgCore(holder, async (tx) => {
      const g = await lockStockWrite(tx, holder);
      const d = await createEntryInTx(
        tx,
        holder,
        g,
        { type: 'issue', lines: [{ itemId: a.item, qty: 1, fromWarehouseId: a.wh }] },
        actorOf(a.boss),
      );
      await submitEntryInTx(tx, holder, g, d.id, actorOf(a.boss));
      held();
      await gate;
    });
    await acquired;
    const racing = code(applyReceiptCorrection(a.ctx, cmdA, actorOf(a.boss)));
    await waitForLockWait();
    release();
    await blocker;
    expect(await racing).toBe('stale_preview');
    expect(await count('stk_corrections', a.org)).toBe(0);
    // order B: the correction holds the gate; the waiting ordinary issue then posts against the corrected stock
    const b = await world();
    const mb = await draft(b);
    const cmdB = await command(b, mb);
    await owner.unsafe(
      `create or replace function public.fr_slow() returns trigger language plpgsql as $$ begin perform pg_sleep(1.5); return new; end $$`,
    );
    await owner.unsafe(
      `create trigger fr_slow before update on public.pos_tickets for each row execute function public.fr_slow()`,
    );
    const applying = applyReceiptCorrection(b.ctx, cmdB, actorOf(b.boss));
    await waitForSleep();
    const wctx = ctxFor(b.org, b.boss); // an independent backend: b.ctx's single connection is busy applying
    const waiter = (async () => {
      const e = await createEntry(
        wctx,
        { type: 'issue', lines: [{ itemId: b.item, qty: 1, fromWarehouseId: b.wh }] },
        actorOf(b.boss),
      );
      await submitEntry(wctx, e.id, actorOf(b.boss));
      return e.id;
    })();
    await waitForLockWait();
    const [applied, issueId] = await Promise.all([applying, waiter]);
    expect(applied).toMatchObject({ replayed: false });
    await owner.unsafe(`drop trigger fr_slow on public.pos_tickets`);
    const row = (
      await owner.unsafe(
        `select qty_after::text qa, valuation_rate::text vr from public.stk_ledger where entry_id='${issueId}'`,
      )
    )[0];
    expect(Number(row.qa)).toBe(Number(mb.intended.terminalQty) - 1);
    expect(Math.abs(Number(row.vr) - Number(mb.intended.terminalRate))).toBeLessThan(1e-8);
  });

  it('period fiscal and permission changes serialize and refuse without financial mutation', async () => {
    const w = await world();
    const m = await draft(w);
    const cmd = await command(w, m);
    const snap = async () => ({
      ledger: await count('stk_ledger', w.org),
      corrections: await count('stk_corrections', w.org),
      bin: await bin(w),
    });
    const before = await snap();
    await owner.unsafe(
      `insert into public.pos_period_locks(org_id,period) values ('${w.org}', to_char(now() at time zone 'America/Lima','YYYY-MM'))`,
    );
    expect(await code(applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss)))).toBe(
      'period_unavailable',
    );
    await owner.unsafe(`delete from public.pos_period_locks where org_id='${w.org}'`);
    expect(await snap()).toEqual(before);
    // the actor loses ownership between preview and apply
    await owner.unsafe(
      `update public.organization_members set role='member' where organization_id='${w.org}' and profile_id='${w.boss}'`,
    );
    expect(await code(applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss)))).toBe(
      'actor_unavailable',
    );
    expect(await snap()).toEqual(before);
    await owner.unsafe(
      `update public.organization_members set role='owner' where organization_id='${w.org}' and profile_id='${w.boss}'`,
    );
    // finance settings (the accounting zone) changing after approval makes the plan stale
    await owner.unsafe(
      `update public.fin_settings set timezone='America/Bogota' where org_id='${w.org}'`,
    );
    expect(await code(applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss)))).toBe(
      'period_unavailable',
    );
    expect(await snap()).toEqual(before);
  });

  it('current correction month carries signed COGS while both finance queries preserve prior month totals', async () => {
    const w = await world();
    // the originals were posted last month
    await owner.unsafe(
      `update public.stk_ledger set posted_at = posted_at - interval '40 days' where org_id='${w.org}'`,
    );
    await owner.unsafe(
      `update public.stk_entries set posted_at = posted_at - interval '40 days' where org_id='${w.org}'`,
    );
    const monthStart = `(date_trunc('month', now() at time zone 'America/Lima') at time zone 'America/Lima')`;
    // the exact shape of finance.service.ts financeSummary and revenueSeries COGS (raw SQL, no cache)
    const summary = async (cmp: '<' | '>=') =>
      Number(
        (
          await owner.unsafe(`select coalesce(-sum(l.value_delta::numeric),0)::float8 cogs from public.stk_ledger l join public.stk_entries e on e.id=l.entry_id
        where e.type='issue' and l.org_id='${w.org}' and l.posted_at ${cmp} ${monthStart}`)
        )[0].cogs,
      );
    const series = async () =>
      (
        await owner.unsafe(`select to_char(date_trunc('month', l.posted_at at time zone 'America/Lima'),'YYYY-MM') b, coalesce(-sum(l.value_delta::numeric),0)::float8 op_cost
        from public.stk_ledger l join public.stk_entries e on e.id=l.entry_id where e.type='issue' and l.org_id='${w.org}' group by 1 order by 1`)
      ).map((r) => [String(r.b), Number(r.op_cost)] as const);
    const priorBefore = await summary('<');
    expect(await summary('>=')).toBe(0);
    const m = await draft(w);
    await applyReceiptCorrection(w.ctx, await command(w, m), actorOf(w.boss));
    expect(Math.abs((await summary('<')) - priorBefore)).toBeLessThan(1e-9); // prior month untouched
    expect(Math.abs((await summary('>=')) - Number(m.intended.netCogsDelta))).toBeLessThan(1e-6); // signed net in the correction month
    const rows = await series();
    expect(rows).toHaveLength(2);
    expect(Math.abs(rows[0][1] - priorBefore)).toBeLessThan(1e-9);
    expect(Math.abs(rows[1][1] - Number(m.intended.netCogsDelta))).toBeLessThan(1e-6);
    expect(Number(m.intended.netCogsDelta)).toBeLessThan(0);
  });

  it('unknown commit recovers the immutable receipt and approved inverse compensation preserves history', async () => {
    const w = await world();
    const originalBin = await bin(w);
    const ledger0 = await count('stk_ledger', w.org);
    const m = await draft(w);
    // never applied: the before-state is intact and nothing is claimed
    expect(await getReceiptCorrectionStatus(w.ctx, statusInput(w, m))).toMatchObject({
      outcome: 'absent_before_unchanged',
      receipt: null,
    });
    await applyReceiptCorrection(w.ctx, await command(w, m), actorOf(w.boss));
    // the response was lost: status returns the immutable receipt, a different current owner may read it
    const st = await getReceiptCorrectionStatus(w.ctx, statusInput(w, m));
    expect(st).toMatchObject({ outcome: 'applied', currentState: 'matches' });
    const corrId = st.outcome === 'applied' ? st.receipt.correctionId : '';
    // approved inverse
    const inv = await compensationDraft(w, corrId);
    expect(inv.action).toBe('compensate');
    // a tampered restored rate is refused, not honoured
    const tampered = { ...inv, intended: { ...inv.intended, receiptRate: '61.5121' } };
    expect(await code(previewReceiptCorrection(w.ctx, tampered))).toBe('invariant_failed');
    const cmd = await command(w, inv);
    const done = await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss));
    expect(done).toMatchObject({
      replayed: false,
      receipt: { action: 'compensate', inverseOfOperationId: corrId },
    });
    // exactness vs the prior originals (not only bin qty/rate): issue costs within 1e-8, accrual values = round4(-original cost)
    inv.intended.effects
      .filter((x) => x.phase === 'issue')
      .forEach((x, i) =>
        expect(Math.abs(Number(x.valueDelta) - Number(m.entries[i + 1].valueDelta))).toBeLessThan(
          1e-8,
        ),
      );
    inv.consumers.forEach((c) => {
      if (c.kind !== 'stock_accrual') return;
      const j = m.entryMap.findIndex((x) => x.replacementEntryId === c.currentEntryId);
      expect(Number(c.intendedRealizedValue)).toBeCloseTo(-Number(m.entries[j].valueDelta), 4);
    });
    // economic state restored; history preserved (two cancelled generations, two operation receipts)
    const restored = await bin(w);
    expect(Number(restored.qty)).toBe(Number(originalBin.qty));
    expect(Math.abs(Number(restored.rate) - Number(originalBin.rate))).toBeLessThan(1e-6);
    expect(await count('stk_ledger', w.org)).toBe(ledger0 + 12);
    expect(await count('stk_corrections', w.org)).toBe(2);
    expect(
      (
        await owner.unsafe(
          `select source_entry_id::text s from public.stk_corrections where operation_key='${inv.operationKey}'`,
        )
      )[0].s,
    ).toBe(m.entryMap[0].replacementEntryId);
    expect(
      (
        await owner.unsafe(
          `select count(*)::int n from public.stk_entries where org_id='${w.org}' and status='cancelled'`,
        )
      )[0].n,
    ).toBe(6);
    // consumers point at the compensating entries; an inverse repeat is a no-op
    expect(
      (
        await owner.unsafe(
          `select realized_entry_id::text e from public.stk_accruals where org_id='${w.org}'`,
        )
      )[0].e,
    ).toBe(inv.entryMap[2].replacementEntryId);
    // the compensating receipt drops the corrected receipt's document hash and keeps the FIRST original time
    const metaOf = async (id: string) =>
      (await owner.unsafe(`select metadata m from public.stk_entries where id='${id}'`))[0]
        .m as Record<string, unknown>;
    const corrected = await metaOf(m.entryMap[0].replacementEntryId);
    const compensating = await metaOf(inv.entryMap[0].replacementEntryId);
    expect(corrected.correctionDocumentSha256).toBeTruthy();
    expect(compensating.correctionDocumentSha256).toBeUndefined();
    expect(compensating.originalPostedAt).toBe(corrected.originalPostedAt);
    expect(compensating.compensatesOperation).toBe(corrId);
    expect(await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).toMatchObject({
      replayed: true,
    });
    expect(await count('stk_ledger', w.org)).toBe(ledger0 + 12);
    expect(await getReceiptCorrectionStatus(w.ctx, statusInput(w, m))).toMatchObject({
      outcome: 'applied',
      currentState: 'compensated',
    });
    // a different key cannot invert the same operation twice, and an inverse of an inverse is unsupported
    expect(await code(compensationDraft(w, corrId))).toBe('unsupported_movement');
    const invId = done.receipt.correctionId;
    expect(await code(compensationDraft(w, invId))).toBe('unsupported_movement');
  });

  it('a corrected chain is never corrected again and status of the first operation stays applied', async () => {
    const w = await world();
    const m = await draft(w);
    const applied = await applyReceiptCorrection(w.ctx, await command(w, m), actorOf(w.boss));
    const rw = { ...w, receipt: m.entryMap[0].replacementEntryId };
    const ledger = await count('stk_ledger', w.org);
    expect(await code(draft(rw))).toBe('unsupported_movement');
    expect(await count('stk_ledger', w.org)).toBe(ledger);
    expect(await count('stk_corrections', w.org)).toBe(1);
    expect(await getReceiptCorrectionStatus(w.ctx, statusInput(w, m))).toMatchObject({
      outcome: 'applied',
      currentState: 'matches',
    });
    // an idempotent replay is still owner-gated: a demoted actor learns nothing
    const cmd = {
      manifest: m,
      approvedPlanSha256: receiptManifestSha256(m),
      previewHash: applied.receipt.previewHash,
    };
    expect(await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).toMatchObject({
      replayed: true,
    });
    await owner.unsafe(
      `update public.organization_members set role='member' where organization_id='${w.org}' and profile_id='${w.boss}'`,
    );
    expect(await code(applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss)))).toBe(
      'actor_unavailable',
    );
  });

  it('the document basis must match the org valuation currency and the exact rounding residual', async () => {
    const w = await world();
    const chain = await owner.unsafe(
      `select l.entry_id::text id from public.stk_ledger l where l.org_id='${w.org}' and l.id >= (select min(id) from public.stk_ledger where entry_id='${w.receipt}') order by l.id`,
    );
    const basis = await basisFor(
      w,
      chain.map((r) => String(r.id)),
    );
    const attempt = (b: DocumentBasis) =>
      draftReceiptCorrectionManifest(w.ctx, {
        target: TARGET,
        sourceCodeSha: SHA40,
        operationKey: randomUUID(),
        receiptEntryId: w.receipt,
        receiptLineId: basis.unitQualification.receiptLineId,
        basis: b,
        postedAt: new Date().toISOString(),
        reason: 'Invoice total correction',
        ownerApprovalReference: 'owner-ok',
      });
    expect(await code(attempt({ ...basis, valuationCurrency: 'USD' }))).toBe('invariant_failed');
    expect(await code(attempt({ ...basis, roundingResidual: '0.0032' }))).toBe('invariant_failed');
    expect(await code(attempt(basis))).toBeNull();
  });

  it('read only preview status and foreign denied principals cannot bypass shared authority or append only grants', async () => {
    const w = await world();
    const m = await draft(w);
    const mgr = await addProfile(w.org, 'member', [
      ['stock', true, true, true, 0],
      ['pos', true, false, false, 0],
    ]);
    const mctx = ctxFor(w.org, mgr);
    expect(await code(previewReceiptCorrection(mctx, { ...m, actorProfileId: mgr }))).toBe(
      'actor_unavailable',
    );
    expect(
      await code(getReceiptCorrectionStatus(mctx, { ...statusInput(w, m), actorProfileId: mgr })),
    ).toBe('actor_unavailable');
    const otherOrg = randomUUID();
    await owner.unsafe(
      `insert into public.organizations(id,name) values ('${otherOrg}','other-${otherOrg.slice(0, 6)}')`,
    );
    const otherBoss = await addProfile(otherOrg, 'owner');
    expect(await code(previewReceiptCorrection(ctxFor(otherOrg, otherBoss), m))).toBe(
      'target_mismatch',
    );
    const pv = await previewReceiptCorrection(w.ctx, m);
    expect(pv).toMatchObject({ eligible: true, outcome: 'preview' });
    expect(await count('stk_corrections', w.org)).toBe(0);
    await owner.unsafe(
      `insert into public.pos_period_locks(org_id,period) values ('${w.org}', to_char(now() at time zone 'America/Lima','YYYY-MM'))`,
    );
    expect(await code(previewReceiptCorrection(w.ctx, m))).toBe('period_unavailable');
    expect(await count('stk_corrections', w.org)).toBe(0);
    await owner.unsafe(`delete from public.pos_period_locks where org_id='${w.org}'`);
    // append-only grants: the operator role cannot rewrite the receipt or the ledger
    await applyReceiptCorrection(
      w.ctx,
      { manifest: m, approvedPlanSha256: receiptManifestSha256(m), previewHash: pv.previewHash },
      actorOf(w.boss),
    );
    for (const stmt of [
      sql`update stk_corrections set reason='x'`,
      sql`delete from stk_corrections`,
      sql`update stk_ledger set value_delta='0'`,
      sql`delete from stk_ledger`,
    ]) {
      await expect(withOrgCore(w.ctx, (tx) => tx.execute(stmt))).rejects.toThrow();
    }
  });
});
