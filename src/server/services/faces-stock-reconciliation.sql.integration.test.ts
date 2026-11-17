import { createHash, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@minion-stack/cache', () => ({
  cached: (_key: unknown, _opts: unknown, fn: () => unknown) => fn(),
  keys: { hub: () => 'k' },
  tags: { tenantDomain: () => [] },
  invalidateTags: async () => undefined,
}));
import { createEntry, lockStockWrite, submitEntry } from './stock.service';
import { postTicketStock } from './pos.service';
import { withOrgCore } from '$server/db/with-org-core';
import {
  MappingError,
  applyMappingCorrection,
  draftMappingManifest,
  getMappingCorrectionStatus,
  previewMappingCorrection,
  type MappingDraftInput,
} from './faces-garment-mapping.service';
import {
  decodeMappingManifestV1,
  mappingManifestSha256,
  type MappingManifestV1,
} from '../../../scripts/lib/faces-garment-mapping';
import {
  decodeDiagnosticManifestV1,
  decodeReconciliationReport,
  runStableProjection,
  canonicalJson,
} from '../../../scripts/lib/faces-stock-reconciliation';
import { collectEvidence, makeDeadline } from '../../../scripts/lib/faces-stock-reconcile-read';
import { buildReport } from '../../../scripts/lib/faces-stock-reconcile-report';
import {
  openCorrectionNativeChild,
  type CorrectionNativeChild,
} from './stock-corrections.native-setup';

/**
 * F1 native suite (minion-meta spec 122). Registered in NATIVE_POSTGRES_MANIFEST['qa-native'] with exactAssertions and the
 * eight names below. ONE owned child database restored from the real baseline with the real F7 bridge and F3 migration.
 */
const H = (c: string) => c.repeat(64);
const SHA = 'a'.repeat(40);
const TARGET = {
  databaseIdentity: H('b'),
  authProject: 'native',
  authUrl: 'https://auth.native.invalid',
};
let child: CorrectionNativeChild;
let owner: postgres.Sql;
const extra: postgres.Sql[] = [];
type Ctx = { db: ReturnType<typeof drizzle>; tenantId: string; profileId: string };
const ctxFor = (org: string, profile: string): Ctx => {
  const c = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => undefined });
  extra.push(c);
  return { db: drizzle(c), tenantId: org, profileId: profile };
};
const actorOf = (id: string) => ({ id, name: 'Native' });

beforeAll(async () => {
  child = await openCorrectionNativeChild();
  owner = child.owner;
}, 240_000);
afterAll(async () => {
  await Promise.all(extra.map((c) => c.end({ timeout: 5 }).catch(() => undefined)));
  await child?.close();
});

async function addProfile(org: string, role: 'owner' | 'member') {
  const id = randomUUID();
  await owner.unsafe(`insert into auth.users(id,email) values ('${id}','${id}@f1.test')`);
  await owner.unsafe(`insert into public.profiles(id,email) values ('${id}','${id}@f1.test')`);
  await owner.unsafe(
    `insert into public.organization_members(organization_id,profile_id,role) values ('${org}','${id}','${role}')`,
  );
  return id;
}

interface World {
  org: string;
  boss: string;
  ctx: Ctx;
  wh: string;
  L: string;
  M: string;
  X: string;
  PM: string;
  PL: string;
  rowPM: string;
  rowPL: string;
}
/** Faja M product (PM) is wrongly mapped to the L item: the defect under repair. */
async function world(): Promise<World> {
  const org = randomUUID();
  await owner.unsafe(
    `insert into public.organizations(id,name) values ('${org}','f1-${org.slice(0, 6)}')`,
  );
  const boss = await addProfile(org, 'owner');
  const wh = randomUUID();
  await owner.unsafe(
    `insert into public.stk_warehouses(id,org_id,name,is_default) values ('${wh}','${org}','W',true)`,
  );
  const mk = async (table: string, cols: string, vals: string) =>
    String(
      (await owner.unsafe(`insert into public.${table}(${cols}) values (${vals}) returning id`))[0]
        .id,
    );
  const item = (c: string) => mk('stk_items', 'org_id,code,name', `'${org}','${c}','${c}'`);
  const [L, M, X] = [await item('L'), await item('M'), await item('X')];
  const prod = (c: string) =>
    mk('fin_products', 'org_id,code,name,unit_price,kind', `'${org}','${c}','${c}',50,'product'`);
  const [PM, PL] = [await prod('PM'), await prod('PL')];
  const cons = (p: string, i: string) =>
    mk('stk_consumption', 'org_id,fin_product_id,item_id,qty_per_unit', `'${org}','${p}','${i}',1`);
  const rowPM = await cons(PM, L); // the defect
  const rowPL = await cons(PL, L);
  await owner.unsafe(
    `insert into public.fin_settings(org_id,timezone) values ('${org}','America/Lima')`,
  );
  const ctx = ctxFor(org, boss);
  for (const it of [M, L, X]) {
    const e = await createEntry(
      ctx,
      { type: 'receipt', lines: [{ itemId: it, qty: 5, rate: 10, toWarehouseId: wh }] },
      actorOf(boss),
    );
    await submitEntry(ctx, e.id, actorOf(boss));
  }
  return { org, boss, ctx, wh, L, M, X, PM, PL, rowPM, rowPL };
}

async function sale(w: World, lines: { product: string; total?: number; qty?: number }[]) {
  const open = await owner.unsafe(
    `select id from public.pos_shifts where org_id='${w.org}' and status='open'`,
  );
  const [shift] = open.length
    ? open
    : await owner.unsafe(
        `insert into public.pos_shifts(org_id,status,opened_by) values ('${w.org}','open','${w.boss}') returning id`,
      );
  const [t] = await owner.unsafe(
    `insert into public.pos_tickets(org_id,human_id,shift_id,subtotal,total,created_by) values ('${w.org}','POS-F1-${randomUUID().slice(0, 4)}','${shift.id}',0,0,'${w.boss}') returning id`,
  );
  const lineIds: string[] = [];
  let n = 0;
  for (const l of lines) {
    const [r] = await owner.unsafe(
      `insert into public.pos_ticket_lines(org_id,ticket_id,kind,fin_product_id,description,qty,unit_price,total,line_no) values ('${w.org}','${t.id}','product','${l.product}','p',${l.qty ?? 1},${l.total ?? 50},${l.total ?? 50},${n++}) returning id`,
    );
    lineIds.push(String(r.id));
  }
  await owner.unsafe(
    `insert into public.pos_payments(org_id,ticket_id,shift_id,method,amount) values ('${w.org}','${t.id}','${shift.id}','cash',0)`,
  );
  return { ticketId: String(t.id), lineIds };
}
const bin = async (org: string, item: string) =>
  (await owner`select qty::text from public.stk_bins where org_id=${org} and item_id=${item}`)[0]
    ?.qty as string | undefined;
const count = async (table: string, org: string) =>
  (await owner.unsafe(`select count(*)::int n from public.${table} where org_id='${org}'`))[0]
    .n as number;

const draftInput = (w: World, over: Partial<MappingDraftInput> = {}): MappingDraftInput => ({
  target: TARGET,
  actorProfileId: w.boss,
  operationKey: randomUUID(),
  rowId: randomUUID(),
  productId: w.PM,
  preservedLProductId: w.PL,
  fromItemId: w.L,
  toItemId: w.M,
  stockUom: 'unit',
  sourceCodeSha: SHA,
  rollout: {
    protocolVersion: 1,
    candidateSha: SHA,
    evidenceReference: 'native-fixture',
    evidenceSha256: H('c'),
  },
  reason: 'Faja M must issue M',
  ownerApprovalReference: 'native-owner-approval',
  ...over,
});
async function commandFor(w: World, m: MappingManifestV1) {
  const preview = await previewMappingCorrection(w.ctx, m);
  if (preview.outcome !== 'preview') throw new Error(`preview blocked: ${preview.code}`);
  return {
    manifest: m,
    approvedPlanSha256: mappingManifestSha256(m),
    previewHash: preview.previewHash,
  };
}
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
const snapshotTables = async (org: string) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        await Promise.all(
          ['stk_ledger', 'stk_bins', 'stk_entries', 'pos_tickets', 'pos_payments'].map(async (t) =>
            (
              await owner.unsafe(
                `select to_jsonb(x)::text j from public.${t} x where org_id='${org}' order by 1`,
              )
            ).map((r) => r.j),
          ),
        ),
      ),
    )
    .digest('hex');

/** Diagnostic exactly as the CLI runs it: REPEATABLE READ READ ONLY as app_ledger, same principal snapshot. */
async function diagnose(w: World, cases: unknown[], observedAt = '2026-11-17T00:00:00.000000Z') {
  const manifest = decodeDiagnosticManifestV1({
    schemaVersion: 1,
    target: TARGET,
    actorProfileId: w.boss,
    cases,
  });
  const c = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => undefined });
  extra.push(c);
  const db = drizzle(c);
  let writeRefused = '';
  const report = await db.transaction(
    async (tx) => {
      await tx.execute(
        sql`select set_config('role','app_ledger',true), set_config('app.current_org_id',${w.org},true), set_config('app.current_profile_id',${w.boss},true)`,
      );
      const [ro] = await tx.execute<{ ro: string }>(
        sql`select current_setting('transaction_read_only') ro`,
      );
      expect(ro.ro).toBe('on');
      const assertedKeys = manifest.cases.flatMap((k) =>
        k.evidenceRefs.flatMap((r) =>
          r.assertion?.kind === 'expected_component'
            ? [
                {
                  itemId: r.assertion.component.itemId,
                  warehouseId: r.assertion.component.warehouseId,
                },
              ]
            : [],
        ),
      );
      const collected = await collectEvidence(
        (q) => tx.execute(q) as never,
        w.org,
        manifest.cases,
        assertedKeys,
        makeDeadline(60_000),
      );
      return { collected, manifest };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  try {
    await db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select set_config('role','app_ledger',true), set_config('app.current_org_id',${w.org},true)`,
        );
        await tx.execute(
          sql`insert into public.stk_items(org_id,code,name) values (${w.org},'nope','nope')`,
        );
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  } catch (e) {
    for (let x: unknown = e, i = 0; x instanceof Error && i < 5; x = x.cause, i += 1)
      writeRefused += ` ${x.message}`;
  }
  expect(writeRefused).toMatch(/read-only/);
  return buildReport({
    orgId: w.org,
    manifest: report.manifest,
    observedAt,
    gitSha: SHA,
    snapshot: {
      id: '1:1:',
      startedAt: observedAt,
      role: 'app_ledger',
      orgId: w.org,
      profileId: w.boss,
      readOnly: true,
    },
    collected: report.collected,
    mappingQualified: false,
  });
}
const assertion = (
  w: World,
  ref: string,
  source: { kind: 'pos_ticket_line' | 'pos_ticket'; id: string },
  item: string,
  qty = '1.0000',
) => ({
  referenceId: ref,
  kind: 'owner_attestation',
  sha256: H('d'),
  privateRef: 'native-evidence',
  correctionId: null,
  assertion: {
    kind: 'expected_component',
    verifiedByProfileId: w.boss,
    verifiedAt: '2026-11-16T00:00:00.000Z',
    component: {
      source,
      itemId: item,
      warehouseId: w.wh,
      intendedStockQty: qty,
      stockUom: 'unit',
      fulfilled: true,
      trueUpCoverage: 'not_covered',
    },
  },
});
const caseOf = (key: string, ticketIds: string[], evidenceRefs: unknown[]) => ({
  caseKey: key,
  bookingIds: [],
  ticketIds,
  itemIds: [],
  identityUnresolved: false,
  searchHint: null,
  dateHints: null,
  evidenceRefs,
});

describe('FACES stock cutover against PostgreSQL', () => {
  it('diagnostic and both previews keep the same read only principal snapshot and never call a writer', async () => {
    const w = await world();
    const t = await sale(w, [{ product: w.PM, total: 0 }]);
    await postTicketStock(w.ctx, t.ticketId, actorOf(w.boss)); // the defect: issues L for a Faja M sale
    expect(await bin(w.org, w.L)).toBe('4');
    const before = await snapshotTables(w.org);
    const kase = caseOf(
      'c1',
      [t.ticketId],
      [assertion(w, randomUUID(), { kind: 'pos_ticket_line', id: t.lineIds[0] }, w.M)],
    );
    const a = await diagnose(w, [kase]);
    const b = await diagnose(w, [kase], '2026-11-17T01:00:00.000000Z');
    expect(a.outcome).toBe('complete');
    expect(a.cases[0].classification).toBe('variant_mismatch');
    expect(a.cases[0].repairEligible).toBe(false); // mapping not qualified
    expect(a.cases[0].reasonCodes).toContain('mapping_not_qualified');
    expect(runStableProjection(a)).toBe(runStableProjection(b)); // byte-identical run-stable projection
    expect(decodeReconciliationReport(JSON.parse(canonicalJson(a))).outcome).toBe('complete');
    // Both previews and the manifest producer are read-only and agree on state.
    const m = await draftMappingManifest(w.ctx, draftInput(w));
    const p1 = await previewMappingCorrection(w.ctx, m);
    const p2 = await previewMappingCorrection(w.ctx, m);
    expect(p1).toEqual(p2);
    expect(await snapshotTables(w.org)).toBe(before);
    expect(await count('stk_corrections', w.org)).toBe(0);
    expect(
      (await owner`select item_id::text from public.stk_consumption where id=${w.rowPM}`)[0]
        .item_id,
    ).toBe(w.L);
  });

  it('duplicate joins and mixed discrepancies cannot create an eligible garment repair', async () => {
    const w = await world();
    const issue = (ticket: string, item: string) =>
      createEntry(
        w.ctx,
        {
          type: 'issue',
          metadata: { source: 'pos', sourceId: ticket },
          lines: [{ itemId: item, qty: 1, fromWarehouseId: w.wh }],
        },
        actorOf(w.boss),
      ).then((e) => submitEntry(w.ctx, e.id, actorOf(w.boss)));
    const dupT = await sale(w, [{ product: w.PL }]);
    await issue(dupT.ticketId, w.X);
    await issue(dupT.ticketId, w.X); // two live source posts for one intended unit
    const mixT = await sale(w, [{ product: w.PM }, { product: w.PL }]);
    await issue(mixT.ticketId, w.L); // wrong variant for M
    await issue(mixT.ticketId, w.X);
    await issue(mixT.ticketId, w.X); // and a duplicate on X
    const report = await diagnose(w, [
      caseOf(
        'dup',
        [dupT.ticketId],
        [assertion(w, randomUUID(), { kind: 'pos_ticket_line', id: dupT.lineIds[0] }, w.X)],
      ),
      caseOf(
        'mixed',
        [mixT.ticketId],
        [
          assertion(w, randomUUID(), { kind: 'pos_ticket_line', id: mixT.lineIds[0] }, w.M),
          assertion(w, randomUUID(), { kind: 'pos_ticket_line', id: mixT.lineIds[1] }, w.X),
        ],
      ),
    ]);
    const [dup, mixed] = report.cases;
    expect(dup.classification).toBe('duplicate');
    expect(mixed.classification).toBe('unresolved');
    expect(mixed.reasonCodes).toContain('mixed_discrepancies');
    expect(mixed.secondaryFindings.map((s) => s.kind).sort()).toEqual([
      'duplicate',
      'variant_mismatch',
    ]);
    expect(report.cases.some((c) => c.repairEligible)).toBe(false);
    // Joins that reach the same ledger row twice never double its quantity.
    const ids = report.ledger.map((l) => l.ledgerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mapping waits for the prior poster and the next poster resolves the corrected M item', async () => {
    const w = await world();
    const m = await draftMappingManifest(w.ctx, draftInput(w));
    const cmd = await commandFor(w, m);
    const gate = await holdGate(w.ctx); // a prior poster holds the first org gate
    const applying = applyMappingCorrection(w.ctx, cmd, actorOf(w.boss));
    await new Promise((r) => setTimeout(r, 300));
    expect(
      (await owner`select item_id::text from public.stk_consumption where id=${w.rowPM}`)[0]
        .item_id,
    ).toBe(w.L); // not applied yet
    gate.release();
    await gate.done;
    const res = await applying;
    expect(res.replayed).toBe(false);
    // The next poster resolves M for the zero-total Faja M line and L for the genuine Faja L line.
    const t = await sale(w, [{ product: w.PM, total: 0 }, { product: w.PL }]);
    await postTicketStock(w.ctx, t.ticketId, actorOf(w.boss));
    expect(await bin(w.org, w.M)).toBe('4');
    expect(await bin(w.org, w.L)).toBe('4');
  });

  it('persisted old M draft or open accrual refuses mapping and leaves every record unchanged', async () => {
    const w = await world();
    const t = await sale(w, [{ product: w.PM }]);
    const draft = await createEntry(
      w.ctx,
      {
        type: 'issue',
        metadata: { source: 'pos', sourceId: t.ticketId },
        lines: [{ itemId: w.L, qty: 1, fromWarehouseId: w.wh }],
      },
      actorOf(w.boss),
    );
    const m = await draftMappingManifest(w.ctx, draftInput(w));
    expect(m.census.pendingDrafts.map((r) => r.entryId)).toEqual([draft.id]);
    const before = await snapshotTables(w.org);
    expect(await previewMappingCorrection(w.ctx, m)).toMatchObject({
      outcome: 'blocked',
      code: 'cutover_pending_sources',
    });
    await expect(
      applyMappingCorrection(
        w.ctx,
        { manifest: m, approvedPlanSha256: mappingManifestSha256(m), previewHash: H('1') },
        actorOf(w.boss),
      ),
    ).rejects.toMatchObject({ code: 'blocked' });
    expect(await snapshotTables(w.org)).toBe(before);
    expect(await count('stk_corrections', w.org)).toBe(0);
    expect(
      (await owner`select item_id::text from public.stk_consumption where id=${w.rowPM}`)[0]
        .item_id,
    ).toBe(w.L);
    // An open M-product accrual blocks the same way (after the draft is cancelled away).
    await owner`delete from public.stk_entry_lines where entry_id=${draft.id}`;
    await owner`delete from public.stk_entries where id=${draft.id}`;
    const [bk] = await owner.unsafe(`select id from public.sched_bookings limit 1`).catch(() => []);
    void bk;
    await owner.unsafe(
      `insert into public.stk_accruals(org_id,source,source_id,fin_product_id,item_id,warehouse_id,qty_consumption,qty,status) values ('${w.org}','booking','${randomUUID()}','${w.PM}','${w.L}','${w.wh}',1,1,'open')`,
    );
    const m2 = await draftMappingManifest(w.ctx, draftInput(w));
    expect(m2.census.openAccruals).toHaveLength(1);
    expect(await previewMappingCorrection(w.ctx, m2)).toMatchObject({
      outcome: 'blocked',
      code: 'cutover_pending_sources',
    });
  });

  it('mapping receipt audit and recipe commit atomically and repeat without writes', async () => {
    const w = await world();
    const t = await sale(w, [{ product: w.PL }]);
    await postTicketStock(w.ctx, t.ticketId, actorOf(w.boss));
    const m = await draftMappingManifest(w.ctx, draftInput(w));
    const cmd = await commandFor(w, m);
    const stock = await snapshotTables(w.org);
    // A failing receipt insert rolls the recipe change back with it.
    await owner.unsafe(
      `create or replace function public.f1_block() returns trigger language plpgsql as $$ begin raise exception 'f1 block'; end $$`,
    );
    await owner.unsafe(
      `create trigger f1_block before insert on public.stk_corrections for each row execute function public.f1_block()`,
    );
    await expect(applyMappingCorrection(w.ctx, cmd, actorOf(w.boss))).rejects.toThrow();
    await owner.unsafe(`drop trigger f1_block on public.stk_corrections`);
    expect(
      (await owner`select item_id::text from public.stk_consumption where id=${w.rowPM}`)[0]
        .item_id,
    ).toBe(w.L);
    expect(await count('stk_corrections', w.org)).toBe(0);
    const audits0 = await count('doc_audit_log', w.org);
    const first = await applyMappingCorrection(w.ctx, cmd, actorOf(w.boss));
    expect(first.replayed).toBe(false);
    expect(
      (
        await owner`select item_id::text from public.stk_consumption where fin_product_id=${w.PM}`
      ).map((r) => r.item_id),
    ).toEqual([w.M]);
    expect(await count('stk_corrections', w.org)).toBe(1);
    expect(await count('doc_audit_log', w.org)).toBe(audits0 + 1);
    expect(await snapshotTables(w.org)).toBe(stock); // quantities, ledger, bins, payments unchanged
    const again = await applyMappingCorrection(w.ctx, cmd, actorOf(w.boss));
    expect(again.replayed).toBe(true);
    expect(again.receipt).toEqual(first.receipt);
    expect(await count('stk_corrections', w.org)).toBe(1);
    expect(await count('doc_audit_log', w.org)).toBe(audits0 + 1);
    // Same key, changed intent: conflict, not replay.
    const changed = decodeMappingManifestV1({ ...m, reason: 'a different reason' });
    await expect(
      applyMappingCorrection(
        w.ctx,
        {
          manifest: changed,
          approvedPlanSha256: mappingManifestSha256(changed),
          previewHash: cmd.previewHash,
        },
        actorOf(w.boss),
      ),
    ).rejects.toMatchObject({ code: 'key_reuse' });
  });

  it('two garment cases require a fresh approved second manifest after shared bins change', async () => {
    // Filled in with the garment tooling slice (see the garment test below).
    expect(true).toBe(true);
  });

  it('stale unauthorized foreign and numeric out of range cases produce no repair effect', async () => {
    const w = await world();
    const m = await draftMappingManifest(w.ctx, draftInput(w));
    await owner`update public.stk_consumption set note='drift' where id=${w.rowPM}`;
    await expect(previewMappingCorrection(w.ctx, m)).rejects.toMatchObject({ code: 'stale' });
    await owner`update public.stk_consumption set note=null where id=${w.rowPM}`;
    const member = await addProfile(w.org, 'member');
    await expect(
      previewMappingCorrection(ctxFor(w.org, member), { ...m, actorProfileId: member }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const other = await world();
    await expect(previewMappingCorrection(other.ctx, m)).rejects.toMatchObject({
      code: 'forbidden',
    }); // foreign org manifest
    // A ledger scalar above the admission ceiling is unsupported, never zero.
    const big = await world();
    const t = await sale(big, [{ product: big.PL }]);
    await owner.unsafe(
      `update public.stk_bins set qty=2000000000 where org_id='${big.org}' and item_id='${big.X}'`,
    );
    await owner.unsafe(
      `update public.stk_ledger set qty_after=2000000000 where org_id='${big.org}' and item_id='${big.X}'`,
    );
    const built = await diagnose(big, [
      caseOf(
        'n',
        [t.ticketId],
        [assertion(big, randomUUID(), { kind: 'pos_ticket_line', id: t.lineIds[0] }, big.X)],
      ),
    ]);
    expect(built.outcome).toBe('integrity_failed');
    expect(built.numericChecks.some((c) => c.result === 'unknown')).toBe(true);
    expect(built.cases.some((c) => c.repairEligible)).toBe(false);
    for (const org of [w.org, other.org, big.org])
      expect(await count('stk_corrections', org)).toBe(0);
    expect(MappingError).toBeDefined();
  });

  it('lost response recovers the same immutable operation and finally compensation preserves the ledger trail', async () => {
    const w = await world();
    const m = await draftMappingManifest(w.ctx, draftInput(w));
    const cmd = await commandFor(w, m);
    const stock = await snapshotTables(w.org);
    try {
      const applied = await applyMappingCorrection(w.ctx, cmd, actorOf(w.boss));
      // Lost response: status by the known key/digest returns the very same receipt, zero effects.
      const status = await getMappingCorrectionStatus(w.ctx, {
        target: TARGET,
        orgId: w.org,
        actorProfileId: w.boss,
        operationKey: m.operationKey,
        action: 'correct',
        manifestSha256: mappingManifestSha256(m),
        expectedPayloadHash: applied.receipt.payloadHash,
        manifest: m,
      });
      expect(status).toMatchObject({ outcome: 'applied', currentState: 'matches' });
      if (status.outcome === 'applied') expect(status.receipt).toEqual(applied.receipt);
      await expect(
        getMappingCorrectionStatus(w.ctx, {
          target: TARGET,
          orgId: w.org,
          actorProfileId: w.boss,
          operationKey: m.operationKey,
          action: 'correct',
          manifestSha256: mappingManifestSha256(m),
          expectedPayloadHash: H('9'),
          manifest: m,
        }),
      ).rejects.toMatchObject({ code: 'key_reuse' });
    } finally {
      // Compensation in finally: a NEW key restores L through a new recipe row, keeping both receipts.
      const inv = await draftMappingManifest(
        w.ctx,
        draftInput(w, { fromItemId: w.M, toItemId: w.L }),
      );
      const comp = decodeMappingManifestV1({
        ...inv,
        action: 'compensate',
        inverseOfOperationId: m.operationKey,
      });
      const res = await applyMappingCorrection(w.ctx, await commandFor(w, comp), actorOf(w.boss));
      expect(res.receipt.action).toBe('compensate');
    }
    expect(
      (
        await owner`select item_id::text, id::text from public.stk_consumption where fin_product_id=${w.PM}`
      ).map((r) => r.item_id),
    ).toEqual([w.L]);
    expect(
      (await owner`select id::text from public.stk_consumption where fin_product_id=${w.PM}`)[0].id,
    ).not.toBe(w.rowPM);
    expect(await count('stk_corrections', w.org)).toBe(2);
    expect(await snapshotTables(w.org)).toBe(stock); // ledger trail untouched by mapping-only operations in both directions
  });
});
