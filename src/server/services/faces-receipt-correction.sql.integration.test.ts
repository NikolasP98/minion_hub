import { createHash, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Cache layers are network clients; the native fixture has none.
vi.mock('@minion-stack/cache', () => ({
  cached: (_key: unknown, _opts: unknown, fn: () => unknown) => fn(),
  keys: { hub: () => 'k' },
  tags: { tenantDomain: () => [] },
  invalidateTags: async () => undefined,
}));
import { createEntry, submitEntry } from './stock.service';
import { receiptRateBasis, type DocumentBasis } from '../../../scripts/lib/faces-receipt-replay';
import {
  ReceiptCorrectionError,
  receiptManifestSha256,
  type ReceiptChainManifestV1,
} from './faces-receipt-correction.logic';
import {
  applyReceiptCorrection,
  draftReceiptCorrectionManifest,
  getReceiptCorrectionStatus,
  previewReceiptCorrection,
} from './faces-receipt-correction.service';
import {
  openCorrectionNativeChild,
  type CorrectionNativeChild,
} from './stock-corrections.native-setup';

/**
 * F2 native receipt-correction suite (spec 123). NOT yet admitted to NATIVE_POSTGRES_MANIFEST (T019): it covers four of the ten
 * quickstart behaviors; see "Implementation deviations" in the spec tasks.md. One owned child database, real F3 helpers.
 */
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const H = (n: number) => n.toString(16).padStart(64, '0');
const SHA40 = 'a'.repeat(40);
let child: CorrectionNativeChild;
let owner: postgres.Sql;
const clients: postgres.Sql[] = [];
const actorOf = (id: string) => ({ id, name: 'Native' });
type Ctx = { db: ReturnType<typeof drizzle>; tenantId: string; profileId: string };
const ctxFor = (org: string, profile: string): Ctx => {
  const client = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => undefined });
  clients.push(client);
  return { db: drizzle(client), tenantId: org, profileId: profile };
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

/** Opening 8 @ 250, receipt 89 stored at 5474.58 per unit (the wrong rate), a POS issue of 10 and a booking issue of 8. */
async function world() {
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
  const receipt = await post('receipt', 89, 5474.58, { providerRef: 'F-1' });
  const [shift] = await owner.unsafe(
    `insert into public.pos_shifts(org_id,status,opened_by) values ('${org}','open','${boss}') returning id`,
  );
  const [ticket] = await owner.unsafe(
    `insert into public.pos_tickets(org_id,human_id,shift_id,subtotal,total,created_by) values ('${org}','POS-${randomUUID().slice(0, 4)}','${shift.id}',50,50,'${boss}') returning id`,
  );
  await owner.unsafe(
    `insert into public.pos_payments(org_id,ticket_id,shift_id,method,amount) values ('${org}','${ticket.id}','${shift.id}','cash',50)`,
  );
  const posIssue = await post('issue', 10, null, { source: 'pos', sourceId: ticket.id });
  await owner.unsafe(
    `update public.pos_tickets set stock_entry_id='${posIssue}' where id='${ticket.id}'`,
  );
  const booking = randomUUID();
  const bookIssue = await post('issue', 8, null, { source: 'booking', sourceId: booking });
  await owner.unsafe(
    `insert into public.stk_accruals(org_id,source,source_id,item_id,warehouse_id,qty_consumption,qty,status,realized_entry_id,realized_qty,realized_value,realized_at)
       values ('${org}','booking','${booking}','${item.id}','${wh.id}',8,8,'realized','${bookIssue}',8,'1999.9999',now())`,
  );
  return {
    org,
    boss,
    ctx,
    wh: String(wh.id),
    item: String(item.id),
    receipt,
    posIssue,
    bookIssue,
    booking,
    ticket: String(ticket.id),
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
  const rb = receiptRateBasis('5474.58', '89');
  return {
    policy: 'verified_document_total',
    reference: 'F-001',
    sha256: H(70),
    valuationCurrency: 'PEN',
    stockQty: '89',
    totalValuation: '5474.58',
    fxEvidenceSha256: H(71),
    taxFreightAllocationSha256: H(72),
    roundingResidual: '0.0031',
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
      documentQuantity: '89',
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
  } as DocumentBasis & { _rb?: typeof rb };
}

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
    target: { databaseIdentity: H(1), authProject: 'local', authUrl: 'http://127.0.0.1:54321' },
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

describe('FACES receipt correction against PostgreSQL', () => {
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
    // quantities preserved; rate/value corrected to the approved terminal state
    const after = await bin(w);
    expect(Number(after.qty)).toBe(Number(before.qty));
    expect(String(Number(after.rate))).toBe(m.intended.terminalRate);
    expect(Number(after.rate)).toBeLessThan(Number(before.rate));
    // originals cancelled and retained; 3 reversal + 3 replacement ledger rows appended
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
    expect(repl.human_id).not.toBeNull(); // new naming-series id; the original id stays only in correctionOf
    expect(
      (
        await owner.unsafe(
          `select uom from public.stk_entry_lines where entry_id='${m.entryMap[0].replacementEntryId}'`,
        )
      )[0].uom,
    ).toBeNull();
    // consumers relinked, accrual value/updated_at updated, quantities and payments untouched
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
    // repeat with the same key and approval: replayed receipt, zero new effects
    const again = await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss));
    expect(again).toMatchObject({ replayed: true });
    expect(await count('stk_ledger', w.org)).toBe(ledgerBefore + 6);
    // authoritative status
    const st = await getReceiptCorrectionStatus(w.ctx, {
      target: m.target,
      orgId: w.org,
      actorProfileId: w.boss,
      operationKey: m.operationKey,
      action: 'correct',
      manifestSha256: receiptManifestSha256(m),
      manifest: m,
    });
    expect(st).toMatchObject({ outcome: 'applied', currentState: 'matches' });
  });

  it('a new movement after the preview is stale, changed intent under a used key conflicts, and a source cannot be corrected twice', async () => {
    const w = await world();
    const m = await draft(w);
    const cmd = await command(w, m);
    // an ordinary issue lands after the preview
    const e = await createEntry(
      w.ctx,
      { type: 'issue', lines: [{ itemId: w.item, qty: 1, fromWarehouseId: w.wh }] },
      actorOf(w.boss),
    );
    await submitEntry(w.ctx, e.id, actorOf(w.boss));
    const corrections = await count('stk_corrections', w.org);
    expect(await code(applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss)))).toBe('stale_preview');
    expect(await count('stk_corrections', w.org)).toBe(corrections);
    // a fresh draft now includes the extra homogeneous issue only if it has a consumer; an unowned issue is unsupported
    expect(await code(draft(w))).toBe('unsupported_movement');
    // same key, changed intent after a successful apply
    const w2 = await world();
    const m2 = await draft(w2);
    await applyReceiptCorrection(w2.ctx, await command(w2, m2), actorOf(w2.boss));
    const changed = { ...m2, reason: 'a different reason' };
    const pv = {
      manifest: changed,
      approvedPlanSha256: receiptManifestSha256(changed),
      previewHash: H(9),
    };
    expect(await code(applyReceiptCorrection(w2.ctx, pv, actorOf(w2.boss)))).toBe('key_reuse');
    // original is now cancelled: a second correction of the same source has no supported shape
    expect(await code(draft(w2))).toBe('unsupported_movement');
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
    // fault after every reversal/replacement/relink step: the ticket relink raises
    await owner.unsafe(
      `create or replace function public.fr_fault() returns trigger language plpgsql as $$ begin raise exception 'injected fault'; end $$`,
    );
    await owner.unsafe(
      `create trigger fr_fault before update on public.pos_tickets for each row execute function public.fr_fault()`,
    );
    await expect(applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).rejects.toBeInstanceOf(
      ReceiptCorrectionError,
    );
    expect(await snapshot()).toEqual(before);
    expect(
      (await owner.unsafe(`select status from public.stk_entries where id='${w.receipt}'`))[0]
        .status,
    ).toBe('submitted');
    await owner.unsafe(`drop trigger fr_fault on public.pos_tickets`);
    // the unchanged approval now applies exactly once
    expect(await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).toMatchObject({
      replayed: false,
    });
    expect(await applyReceiptCorrection(w.ctx, cmd, actorOf(w.boss))).toMatchObject({
      replayed: true,
    });
    expect((await snapshot()).ledger).toBe(before.ledger + 6);
  });

  it('read only preview status and foreign denied principals cannot bypass shared authority', async () => {
    const w = await world();
    const m = await draft(w);
    // a stock manager without ownership or finance cost authority is refused generically, with zero reads of cost data
    const mgr = await addProfile(w.org, 'member', [
      ['stock', true, true, true, 0],
      ['pos', true, false, false, 0],
    ]);
    const mctx = ctxFor(w.org, mgr);
    expect(await code(previewReceiptCorrection(mctx, { ...m, actorProfileId: mgr }))).toBe(
      'actor_unavailable',
    );
    // another organization's owner cannot reach this org's source
    const otherOrg = randomUUID();
    await owner.unsafe(
      `insert into public.organizations(id,name) values ('${otherOrg}','other-${otherOrg.slice(0, 6)}')`,
    );
    const otherBoss = await addProfile(otherOrg, 'owner');
    expect(await code(previewReceiptCorrection(ctxFor(otherOrg, otherBoss), m))).toBe(
      'target_mismatch',
    );
    // preview never writes
    const pv = await previewReceiptCorrection(w.ctx, m);
    expect(pv).toMatchObject({ eligible: true, outcome: 'preview' });
    expect(await count('stk_corrections', w.org)).toBe(0);
    // a locked correction month refuses with no financial mutation
    await owner.unsafe(
      `insert into public.pos_period_locks(org_id,period) values ('${w.org}', to_char(now() at time zone 'America/Lima','YYYY-MM'))`,
    );
    expect(await code(previewReceiptCorrection(w.ctx, m))).toBe('period_unavailable');
    expect(
      await code(
        applyReceiptCorrection(
          w.ctx,
          {
            manifest: m,
            approvedPlanSha256: receiptManifestSha256(m),
            previewHash: pv.previewHash,
          },
          actorOf(w.boss),
        ),
      ),
    ).toBe('period_unavailable');
    expect(await count('stk_corrections', w.org)).toBe(0);
  });
});
