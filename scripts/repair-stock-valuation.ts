/**
 * ONE-TIME repair for the FACES stock ledger valuation corruption.
 *
 * Background: the P5.1 seed (scripts/seed-stock-faces.ts) replayed the legacy
 * CSV movements from an EMPTY bin with no opening-balance receipt. The source
 * history contains issues (consumption) dated before the receipts that stocked
 * them, so bins went negative and the moving-average `valuation_rate` corrupted
 * (went negative → `value_delta` flipped sign → the finances "Operational cost"
 * chart band spiked/inverted). Current bin QUANTITIES are correct (reconciled to
 * target); only the per-row valuation snapshots are wrong.
 *
 * Fix (accurate, not fabricated — the business DID hold opening inventory; the
 * CSV just omits the opening receipt): inject a per-item opening-balance receipt
 * sized to keep the bin non-negative throughout, recompute every movement row's
 * value in posted_at order, and rebuild the reconciliation adjustment + bins so
 * final quantities are unchanged. Future data flows through the hub UI
 * (submitEntry) in chronological order, so this backfill is genuinely one-time.
 *
 * SAFE BY DEFAULT: dry-run (prints the plan + verification, writes nothing).
 * Pass --apply to commit inside a single transaction. --force re-runs even if a
 * prior repair marker exists (deletes the prior opening/recon first).
 *
 * Run:
 *   bun run scripts/repair-stock-valuation.ts [orgId] [--apply] [--force]
 *   (orgId defaults to the FACES org)
 */
import postgres from 'postgres';
import { applyLedgerDelta, computeLegValue, type BinState } from '../src/server/services/stock.logic';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const force = args.includes('--force');
const orgId = args.find((a) => !a.startsWith('--')) ?? FACES_ORG;

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set (check .env.local)');
const client = postgres(url, { prepare: false, max: 5 });

const OPENING_SRC = 'repair-opening-balance';
const RECON_NOTE = 'Reconciliación (repair)';
const money = (n: number) => `S/ ${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

interface Row {
  id: string;
  item_id: string;
  entry_id: string;
  qd: number;
  posted_at: Date;
  type: string;
  is_recon: boolean;
  line_rate: number | null;
}

async function main() {
  // Guard: already repaired?
  const [{ n: repaired }] = (await client`
    select count(*)::int n from stk_entries
    where org_id = ${orgId} and metadata->>'source' = ${OPENING_SRC}`) as unknown as { n: number }[];
  if (repaired > 0 && !force) {
    console.error(`org ${orgId} already has a repair opening-balance entry — pass --force to redo.`);
    process.exit(1);
  }

  const rows = (await client`
    select l.id, l.item_id, l.entry_id, l.qty_delta::float8 qd, l.posted_at,
           e.type, (e.metadata->>'reconciliation' = 'true') as is_recon,
           (select el.rate::float8 from stk_entry_lines el
              where el.entry_id = l.entry_id and el.item_id = l.item_id limit 1) as line_rate
    from stk_ledger l join stk_entries e on e.id = l.entry_id
    where l.org_id = ${orgId}
    order by l.item_id, l.posted_at, l.id`) as unknown as Row[];
  if (!rows.length) {
    console.error(`no ledger rows for org ${orgId}`);
    process.exit(1);
  }

  const bins = (await client`
    select item_id, qty::float8 q, valuation_rate::float8 vr from stk_bins where org_id = ${orgId}`) as unknown as {
    item_id: string;
    q: number;
    vr: number;
  }[];
  const targetQty = new Map(bins.map((b) => [b.item_id, b.q]));
  const curRate = new Map(bins.map((b) => [b.item_id, b.vr]));

  // Movements = non-reconciliation rows (receipts + issues). We rebuild recon.
  const byItem = new Map<string, Row[]>();
  for (const r of rows) (byItem.get(r.item_id) ?? byItem.set(r.item_id, []).get(r.item_id)!).push(r);

  const earliest = rows.reduce((min, r) => (r.posted_at < min ? r.posted_at : min), rows[0].posted_at);
  const openingDate = new Date(earliest.getTime() - 86_400_000); // 1 day before first movement

  const plan: Array<{
    itemId: string;
    openingQty: number;
    openingRate: number;
    reconQty: number;
    finalQty: number;
    target: number;
    updates: Array<{ id: string; qtyAfter: number; rate: number; valueDelta: number }>;
    monthCost: Map<string, number>;
  }> = [];

  for (const [itemId, itemRows] of byItem) {
    const movements = itemRows.filter((r) => !r.is_recon);
    // item unit cost: first receipt's line rate, else current bin rate, else 0.
    const openingRate = movements.find((r) => r.qd >= 0)?.line_rate ?? curRate.get(itemId) ?? 0;

    // opening qty = cover the deepest deficit reached replaying from 0.
    let q = 0;
    let minRun = 0;
    let sumMv = 0;
    for (const r of movements) {
      q += r.qd;
      if (q < minRun) minRun = q;
      sumMv += r.qd;
    }
    const openingQty = Math.max(0, -minRun);

    // Recompute each movement row's value from the opening balance forward.
    let bin: BinState = { qty: openingQty, rate: openingRate };
    const updates: Array<{ id: string; qtyAfter: number; rate: number; valueDelta: number }> = [];
    const monthCost = new Map<string, number>();
    for (const r of movements) {
      const inRate = r.qd >= 0 ? (r.line_rate ?? openingRate) : null;
      const { valueDelta } = computeLegValue(bin, r.qd, inRate);
      bin = applyLedgerDelta(bin, r.qd, valueDelta);
      updates.push({ id: r.id, qtyAfter: bin.qty, rate: bin.rate, valueDelta });
      if (r.type === 'issue') {
        const m = r.posted_at.toISOString().slice(0, 7);
        monthCost.set(m, (monthCost.get(m) ?? 0) - valueDelta); // −valueDelta = cost consumed
      }
    }

    const target = targetQty.get(itemId) ?? bin.qty;
    const reconQty = target - openingQty - sumMv; // land exactly on current inventory
    plan.push({ itemId, openingQty, openingRate, reconQty, finalQty: target, target, updates, monthCost });
  }

  // ── verification / report ────────────────────────────────────────────────
  const totalMonth = new Map<string, number>();
  let negRate = 0;
  for (const p of plan) {
    for (const u of p.updates) if (u.rate < -1e-6) negRate++;
    for (const [m, v] of p.monthCost) totalMonth.set(m, (totalMonth.get(m) ?? 0) + v);
  }
  const openingItems = plan.filter((p) => p.openingQty > 1e-6);
  console.log(`\n─── repair plan for org ${orgId} (${apply ? 'APPLY' : 'DRY-RUN'}) ───`);
  console.log(`items: ${plan.length}   opening-balance receipts: ${openingItems.length}   movement rows re-valued: ${plan.reduce((s, p) => s + p.updates.length, 0)}`);
  console.log(`negative valuation_rate rows after repair: ${negRate}  (must be 0)`);
  console.log(`opening total value: ${money(openingItems.reduce((s, p) => s + p.openingQty * p.openingRate, 0))}`);
  console.log('\nmonthly operational cost (issues) after repair:');
  for (const [m, v] of [...totalMonth.entries()].sort()) console.log(`  ${m}: ${money(v)}`);

  if (!apply) {
    console.log('\nDRY-RUN — no changes written. Re-run with --apply to commit.');
    await client.end();
    return;
  }

  // Safety net: snapshot the org's ledger + entries before any mutation so the
  // repair is reversible (value_delta/valuation_rate are derived, but the recon
  // entries get deleted/recreated). One table per kind; --force overwrites.
  await client`drop table if exists stk_ledger_bak_repair`;
  await client`create table stk_ledger_bak_repair as select * from stk_ledger where org_id = ${orgId}`;
  await client`drop table if exists stk_entries_bak_repair`;
  await client`create table stk_entries_bak_repair as select * from stk_entries where org_id = ${orgId}`;
  console.log('backed up stk_ledger → stk_ledger_bak_repair, stk_entries → stk_entries_bak_repair');

  // ── apply (single transaction) ───────────────────────────────────────────
  await client.begin(async (tx) => {
    if (force) {
      // remove any prior repair artifacts first
      await tx`delete from stk_ledger where org_id = ${orgId} and entry_id in (
        select id from stk_entries where org_id = ${orgId} and metadata->>'source' = ${OPENING_SRC})`;
      await tx`delete from stk_entry_lines where org_id = ${orgId} and entry_id in (
        select id from stk_entries where org_id = ${orgId} and metadata->>'source' = ${OPENING_SRC})`;
      await tx`delete from stk_entries where org_id = ${orgId} and metadata->>'source' = ${OPENING_SRC}`;
    }
    // Drop existing reconciliation adjustments (we rebuild them).
    await tx`delete from stk_ledger where org_id = ${orgId} and entry_id in (
      select id from stk_entries where org_id = ${orgId} and metadata->>'reconciliation' = 'true')`;
    await tx`delete from stk_entry_lines where org_id = ${orgId} and entry_id in (
      select id from stk_entries where org_id = ${orgId} and metadata->>'reconciliation' = 'true')`;
    await tx`delete from stk_entries where org_id = ${orgId} and metadata->>'reconciliation' = 'true'`;

    const [{ id: warehouseId }] = (await tx`select id from stk_warehouses where org_id = ${orgId} limit 1`) as unknown as { id: string }[];

    // 1) opening-balance receipt (one entry, positive lines).
    const openers = plan.filter((p) => p.openingQty > 1e-6);
    if (openers.length) {
      const [op] = (await tx`
        insert into stk_entries (org_id, type, status, note, posted_at, metadata)
        values (${orgId}, 'receipt', 'submitted', 'Saldo inicial (repair)', ${openingDate},
                ${client.json({ source: OPENING_SRC })})
        returning id`) as unknown as { id: string }[];
      let lineNo = 0;
      for (const p of openers) {
        await tx`insert into stk_entry_lines (org_id, entry_id, item_id, qty, uom, rate, to_warehouse_id, line_no)
          values (${orgId}, ${op.id}, ${p.itemId}, ${String(p.openingQty)}, 'Unidad', ${String(p.openingRate)}, ${warehouseId}, ${lineNo++})`;
        await tx`insert into stk_ledger (org_id, item_id, warehouse_id, entry_id, qty_delta, qty_after, valuation_rate, value_delta, posted_at)
          values (${orgId}, ${p.itemId}, ${warehouseId}, ${op.id}, ${String(p.openingQty)}, ${String(p.openingQty)},
                  ${String(p.openingRate)}, ${String(p.openingQty * p.openingRate)}, ${openingDate})`;
      }
    }

    // 2) re-value every movement ledger row in place.
    for (const p of plan) {
      for (const u of p.updates) {
        await tx`update stk_ledger set qty_after = ${String(u.qtyAfter)}, valuation_rate = ${String(u.rate)}, value_delta = ${String(u.valueDelta)}
          where id = ${u.id}`;
      }
    }

    // 3) rebuild reconciliation adjustments (pos = found stock, neg = shrink).
    const recon = plan.filter((p) => Math.abs(p.reconQty) > 1e-6);
    const reconDate = new Date('2026-07-01T00:00:00Z');
    for (const dir of ['pos', 'neg'] as const) {
      const lines = recon.filter((p) => (dir === 'pos' ? p.reconQty > 0 : p.reconQty < 0));
      if (!lines.length) continue;
      const [re] = (await tx`
        insert into stk_entries (org_id, type, status, note, posted_at, metadata)
        values (${orgId}, 'adjustment', 'submitted', ${RECON_NOTE}, ${reconDate}, ${client.json({ source: OPENING_SRC, reconciliation: true })})
        returning id`) as unknown as { id: string }[];
      let lineNo = 0;
      for (const p of lines) {
        const mag = Math.abs(p.reconQty);
        const rate = curRate.get(p.itemId) ?? p.openingRate;
        await tx`insert into stk_entry_lines (org_id, entry_id, item_id, qty, uom, rate, from_warehouse_id, to_warehouse_id, line_no)
          values (${orgId}, ${re.id}, ${p.itemId}, ${String(mag)}, 'Unidad', ${dir === 'pos' ? String(rate) : null},
                  ${dir === 'pos' ? null : warehouseId}, ${dir === 'pos' ? warehouseId : null}, ${lineNo++})`;
        const qtyDelta = dir === 'pos' ? mag : -mag;
        await tx`insert into stk_ledger (org_id, item_id, warehouse_id, entry_id, qty_delta, qty_after, valuation_rate, value_delta, posted_at)
          values (${orgId}, ${p.itemId}, ${warehouseId}, ${re.id}, ${String(qtyDelta)}, ${String(p.target)},
                  ${String(rate)}, ${String(qtyDelta * (dir === 'pos' ? rate : rate))}, ${reconDate})`;
      }
    }

    // 4) rewrite bins to the recomputed finals (qty unchanged = target; rate refreshed).
    for (const p of plan) {
      const rate = curRate.get(p.itemId) ?? p.openingRate;
      await tx`update stk_bins set qty = ${String(p.target)}, valuation_rate = ${String(rate)}, updated_at = now()
        where org_id = ${orgId} and item_id = ${p.itemId}`;
    }
  });

  // ── post-apply verification ───────────────────────────────────────────────
  const [{ n: negAfter }] = (await client`
    select count(*)::int n from stk_ledger where org_id = ${orgId} and valuation_rate::numeric < 0`) as unknown as { n: number }[];
  const binsAfter = (await client`select item_id, qty::float8 q from stk_bins where org_id = ${orgId}`) as unknown as { item_id: string; q: number }[];
  let mismatch = 0;
  for (const b of binsAfter) if (Math.abs(b.q - (targetQty.get(b.item_id) ?? b.q)) > 0.5) mismatch++;
  console.log(`\nAPPLIED. negative-rate rows now: ${negAfter}   bin qty mismatches vs target: ${mismatch}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
