/**
 * P5.1 FACES stock seed — replays real movement history from the 4 SUSII/
 * legacy CSVs (already normalized to JSON by the caller) into the stk_*
 * tables on PROD Supabase PG. Design: specs/hub-erp-roadmap/
 * P5.1-stock-interconnect-seed.md §D4.
 *
 * Connects as the `postgres` owner (bypasses RLS) — every row sets org_id
 * explicitly instead of relying on withOrgCore's GUC dance. Reuses the pure
 * valuation math from stock.logic.ts and the real naming-series counter
 * (naming_series_counters, prefix STE-.YYYY.-) so seeded human_ids sit in the
 * same sequence real submitEntry() calls would produce.
 *
 * Idempotent: aborts if stk_items has rows for the org unless --force (which
 * wipes prior seeded stk_* + stk_consumption rows and the STE-2026- counter for
 * this org first, in FK-safe order).
 *
 * Run:
 *   bun run scripts/seed-stock-faces.ts <path-to-normalized-json> [--force]
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql, eq } from 'drizzle-orm';
import {
  stkItems,
  stkWarehouses,
  stkEntries,
  stkEntryLines,
  stkLedger,
  stkBins,
} from '../src/server/db/pg-schema/stock';
import { finProducts } from '../src/server/db/pg-finance-schema';
import {
  applyLedgerDelta,
  computeLegValue,
  EMPTY_BIN,
  type BinState,
} from '../src/server/services/stock.logic';
import { nextSerialId } from '../src/server/services/naming-series';

// ── input ────────────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const force = cliArgs.includes('--force');
const jsonPath = cliArgs.find((a) => !a.startsWith('--'));
if (!jsonPath) {
  console.error('usage: bun run scripts/seed-stock-faces.ts <path-to-normalized-json> [--force]');
  process.exit(1);
}

interface CatalogRow {
  src_id: string;
  name: string;
  family: string;
  cost_price: number;
  type: string;
  avg_cost: number;
}
interface LevelRow {
  src_id: string;
  name: string;
  avg_cost: number;
  units: number;
  min: number;
  max: number;
}
interface MovementRow {
  ts: string;
  product: string;
  type: string;
  qty: number;
  stock_after: number;
  comment: string;
}
interface SeedData {
  catalog: CatalogRow[];
  levels: LevelRow[];
  movements: MovementRow[];
  org_id: string;
}

const data = JSON.parse(readFileSync(jsonPath, 'utf8')) as SeedData;
const orgId = data.org_id;
if (!orgId) throw new Error('input JSON missing org_id');

const EPS = 1e-6;
const RECON_DATE = new Date('2026-07-01T00:00:00Z');

// ── db ───────────────────────────────────────────────────────────────────
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set (check .env.local)');
const client = postgres(url, { prepare: false, max: 5 });
const db = drizzle(client);

// ── name normalization (accent/case-insensitive matching) ──────────────────
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
// ponytail: one manual alias for the one case normalization can't bridge
// (renamed product in fin_products vs. the legacy CSV name); add more here if
// future imports hit the same drift.
const NAME_ALIASES: Record<string, string> = { 'lip defense': 'lip defender' };

// ── consumption heuristics (spec D4 step 5) ─────────────────────────────────
function matchOperaCaja(norm: string): string | null {
  if (/\bopera\s+iv\b/.test(norm)) return 'HA Opera IV (Caja)';
  if (/\bopera\s+iii\b/.test(norm)) return 'HA Opera III (Caja)';
  if (/\bopera\s+ii\b/.test(norm)) return 'HA Opera II (Caja)';
  if (/\bopera\s+i\b/.test(norm)) return 'HA Opera I (Caja)';
  return null;
}
function matchSayphaCaja(norm: string): string | null {
  if (norm.includes('saypha volume plus')) return 'HA Saypha Volume Plus (Caja)';
  if (norm.includes('saypha filler')) return 'HA Saypha Filler (Caja)';
  if (norm.includes('saypha volume')) return 'HA Saypha Volume (Caja)';
  return null;
}
interface ConsumptionMatch {
  itemName: string;
  qty: number;
  note?: string;
}
function matchConsumption(finProductName: string): ConsumptionMatch | null {
  const n = normalize(finProductName);
  const opera = matchOperaCaja(n);
  if (opera) return { itemName: opera, qty: 1 };
  const saypha = matchSayphaCaja(n);
  if (saypha) return { itemName: saypha, qty: 1 };
  if (n.includes('toxina') || n.includes('botox'))
    return { itemName: 'Toxina Botulinica (units)', qty: 30 };
  if (n.includes('nctf')) return { itemName: 'NCTF', qty: 1 };
  if (n.includes('hialuronidasa')) {
    return { itemName: 'Hialuronidasa', qty: 10, note: 'confirmed: 10 mL/procedure; 15 mL/vial' };
  }
  return null;
}

// ── FK-safe wipe for --force ─────────────────────────────────────────────
async function wipeOrgStock(orgId: string) {
  console.log('--force: wiping prior seeded stk_* rows for org', orgId);
  await client`delete from stk_ledger where org_id = ${orgId}`;
  await client`delete from stk_entry_lines where org_id = ${orgId}`;
  await client`delete from stk_bins where org_id = ${orgId}`;
  await client`delete from stk_consumption where org_id = ${orgId}`;
  await client`delete from stk_entries where org_id = ${orgId}`;
  await client`delete from stk_items where org_id = ${orgId}`;
  await client`delete from stk_warehouses where org_id = ${orgId}`;
  await client`delete from naming_series_counters where org_id = ${orgId} and prefix = 'STE-2026-'`;
}

async function main() {
  const existing = await db
    .select({ id: stkItems.id })
    .from(stkItems)
    .where(eq(stkItems.orgId, orgId))
    .limit(1);
  if (existing.length && !force) {
    console.error(`stk_items already has rows for org ${orgId} — pass --force to wipe + reseed.`);
    process.exit(1);
  }
  if (existing.length && force) await wipeOrgStock(orgId);

  const finProductRows = await db
    .select({ id: finProducts.id, name: finProducts.name })
    .from(finProducts)
    .where(eq(finProducts.orgId, orgId));
  const finByNorm = new Map<string, { id: string; name: string }>();
  for (const p of finProductRows) finByNorm.set(normalize(p.name), { id: p.id, name: p.name });
  function matchFinProduct(itemName: string): { id: string; name: string } | null {
    const norm = normalize(itemName);
    return finByNorm.get(NAME_ALIASES[norm] ?? norm) ?? finByNorm.get(norm) ?? null;
  }

  const catalogStock = data.catalog.filter(
    (c) => c.type === 'Producto a la venta' || c.type === 'Producto interno',
  );
  const levelsBySrc = new Map(data.levels.map((l) => [l.src_id, l]));

  const itemPlan = catalogStock.map((c) => {
    const lvl = levelsBySrc.get(c.src_id);
    const min = lvl?.min ?? null;
    const max = lvl?.max ?? null;
    const reorderQty = min != null && max != null && max > min ? max - min : null;
    const fin = matchFinProduct(c.name);
    const isHialuronidasa = c.src_id === '1262' && normalize(c.name) === 'hialuronidasa';
    // ponytail: `||` (not `??`) on purpose — 0 means "no priced data", fall through.
    const rate = (lvl?.avg_cost || c.avg_cost || c.cost_price || 0) as number;
    return {
      insert: {
        orgId,
        code: c.src_id,
        name: c.name,
        uom: 'Unidad',
        consumptionUom: isHialuronidasa ? 'mL' : null,
        unitsPerStockUom: isHialuronidasa ? '15' : null,
        itemGroup: c.family || null,
        reorderLevel: min != null ? String(min) : null,
        reorderQty: reorderQty != null ? String(reorderQty) : null,
        finProductId: fin?.id ?? null,
      },
      rate,
      matchedFinName: fin?.name ?? null,
    };
  });

  await db.transaction(async (tx) => {
    const [warehouse] = await tx
      .insert(stkWarehouses)
      .values({ orgId, name: 'Almacén Principal' })
      .returning();

    const insertedItems = await tx
      .insert(stkItems)
      .values(itemPlan.map((p) => p.insert))
      .returning();

    console.log(`\n24-item catalog seeded (fin_product_id matches):`);
    console.log('code  name'.padEnd(38) + 'fin_product match');
    const itemByName = new Map<string, (typeof insertedItems)[number]>();
    const rateByItemId = new Map<string, number>();
    insertedItems.forEach((row, i) => {
      itemByName.set(row.name, row);
      rateByItemId.set(row.id, itemPlan[i].rate);
      console.log(
        `${row.code.padEnd(6)}${row.name.padEnd(32)}${itemPlan[i].matchedFinName ?? '(none)'}`,
      );
    });
    const nullFinMatches = itemPlan.filter((p) => !p.matchedFinName).map((p) => p.insert.name);

    // ── group movements by (date, sign, type) → one stk_entry per group ────
    const movements = data.movements;
    interface Group {
      sign: 'in' | 'out';
      type: string;
      members: MovementRow[];
      firstTs: string;
    }
    const groups = new Map<string, Group>();
    const groupKeyByIdx: string[] = new Array(movements.length);
    movements.forEach((m, idx) => {
      const date = m.ts.slice(0, 10);
      const sign: 'in' | 'out' = m.qty >= 0 ? 'in' : 'out';
      const key = `${date}|${sign}|${m.type}`;
      if (!groups.has(key)) groups.set(key, { sign, type: m.type, members: [], firstTs: m.ts });
      groups.get(key)!.members.push(m);
      groupKeyByIdx[idx] = key;
    });
    const orderedKeys = [...groups.keys()].sort((a, b) =>
      groups.get(a)!.firstTs.localeCompare(groups.get(b)!.firstTs),
    );

    const entryIdByKey = new Map<string, string>();
    for (const key of orderedKeys) {
      const g = groups.get(key)!;
      const comments = [...new Set(g.members.map((m) => m.comment).filter((c) => c && c.trim()))];
      const note = comments.length ? `${g.type} (${comments.length} mov.)` : g.type;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CoreTx's generic schema param doesn't match this script's schema-less tx; structurally identical (.execute()).
      const humanId = await nextSerialId(tx as any, orgId, 'STE-.YYYY.-', new Date(g.firstTs));
      const [entry] = await tx
        .insert(stkEntries)
        .values({
          orgId,
          humanId,
          type: g.sign === 'in' ? 'receipt' : 'issue',
          status: 'submitted',
          note,
          postedAt: new Date(g.firstTs),
          metadata: { source: 'seed-faces-csv', movementType: g.type, comments },
        })
        .returning();
      entryIdByKey.set(key, entry.id);
    }

    // entry_lines — one per movement, grouped/ordered by its entry
    const entryLineRows: (typeof stkEntryLines.$inferInsert)[] = [];
    for (const key of orderedKeys) {
      const g = groups.get(key)!;
      const entryId = entryIdByKey.get(key)!;
      g.members.forEach((m, lineNo) => {
        const item = itemByName.get(m.product);
        if (!item) throw new Error(`unknown product in movements: ${m.product}`);
        const isIn = m.qty >= 0;
        entryLineRows.push({
          orgId,
          entryId,
          itemId: item.id,
          qty: String(Math.abs(m.qty)),
          uom: 'Unidad',
          rate: isIn ? String(rateByItemId.get(item.id) ?? 0) : null,
          fromWarehouseId: isIn ? null : warehouse.id,
          toWarehouseId: isIn ? warehouse.id : null,
          lineNo,
        });
      });
    }
    if (entryLineRows.length) await tx.insert(stkEntryLines).values(entryLineRows);

    // ── ledger replay: strict ts order, per-item moving-average bin state ──
    const binState = new Map<string, BinState>();
    const ledgerRows: (typeof stkLedger.$inferInsert)[] = [];
    let mismatchCount = 0;
    movements.forEach((m, idx) => {
      const item = itemByName.get(m.product)!;
      const bin = binState.get(item.id) ?? { ...EMPTY_BIN };
      const qtyDelta = m.qty;
      const rate = qtyDelta >= 0 ? (rateByItemId.get(item.id) ?? 0) : null;
      const { valueDelta } = computeLegValue(bin, qtyDelta, rate);
      const next = applyLedgerDelta(bin, qtyDelta, valueDelta);
      binState.set(item.id, next);
      if (Math.abs(next.qty - m.stock_after) > 1e-3) mismatchCount++;
      ledgerRows.push({
        orgId,
        itemId: item.id,
        warehouseId: warehouse.id,
        entryId: entryIdByKey.get(groupKeyByIdx[idx])!,
        qtyDelta: String(qtyDelta),
        qtyAfter: String(next.qty),
        valuationRate: String(next.rate),
        valueDelta: String(valueDelta),
        postedAt: new Date(m.ts),
      });
    });
    if (mismatchCount)
      console.warn(
        `⚠ ${mismatchCount} movement(s) where our replay's running qty diverges from the CSV's own stock_after (source data drift — reconciliation below corrects the final total).`,
      );
    for (let i = 0; i < ledgerRows.length; i += 1000)
      await tx.insert(stkLedger).values(ledgerRows.slice(i, i + 1000));

    // ── reconciliation: force finals to match export(1) units (18 items);
    // items absent from levels reconcile to their own last replayed qty,
    // floored at 0. ──────────────────────────────────────────────────────
    const targetByItemId = new Map<string, number>();
    for (const row of insertedItems) {
      const lvl = data.levels.find((l) => l.name === row.name);
      const finalQty = binState.get(row.id)?.qty ?? 0;
      targetByItemId.set(row.id, lvl ? lvl.units : Math.max(finalQty, 0));
    }
    const posAdj: { itemId: string; qty: number }[] = [];
    const negAdj: { itemId: string; qty: number }[] = [];
    for (const row of insertedItems) {
      const finalQty = binState.get(row.id)?.qty ?? 0;
      const target = targetByItemId.get(row.id)!;
      const diff = target - finalQty;
      if (diff > EPS) posAdj.push({ itemId: row.id, qty: diff });
      else if (diff < -EPS) negAdj.push({ itemId: row.id, qty: -diff });
    }
    let adjEntryCount = 0;
    let adjLedgerCount = 0;
    for (const [dir, lines] of [['pos', posAdj] as const, ['neg', negAdj] as const]) {
      if (!lines.length) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above the first nextSerialId call
      const humanId = await nextSerialId(tx as any, orgId, 'STE-.YYYY.-', RECON_DATE);
      const [entry] = await tx
        .insert(stkEntries)
        .values({
          orgId,
          humanId,
          type: 'adjustment',
          status: 'submitted',
          note: 'Reconciliación import CSV',
          postedAt: RECON_DATE,
          metadata: { source: 'seed-faces-csv', reconciliation: true },
        })
        .returning();
      adjEntryCount++;
      const lineRows = lines.map((l, lineNo) => ({
        orgId,
        entryId: entry.id,
        itemId: l.itemId,
        qty: String(l.qty),
        uom: 'Unidad',
        rate:
          dir === 'pos'
            ? String(binState.get(l.itemId)?.rate || rateByItemId.get(l.itemId) || 0)
            : null,
        fromWarehouseId: dir === 'pos' ? null : warehouse.id,
        toWarehouseId: dir === 'pos' ? warehouse.id : null,
        lineNo,
      }));
      await tx.insert(stkEntryLines).values(lineRows);
      const adjLedgerRows = lines.map((l) => {
        const bin = binState.get(l.itemId) ?? { ...EMPTY_BIN };
        const qtyDelta = dir === 'pos' ? l.qty : -l.qty;
        const rate =
          dir === 'pos' ? Number(lineRows.find((r) => r.itemId === l.itemId)!.rate) : null;
        const { valueDelta } = computeLegValue(bin, qtyDelta, rate);
        const next = applyLedgerDelta(bin, qtyDelta, valueDelta);
        binState.set(l.itemId, next);
        return {
          orgId,
          itemId: l.itemId,
          warehouseId: warehouse.id,
          entryId: entry.id,
          qtyDelta: String(qtyDelta),
          qtyAfter: String(next.qty),
          valuationRate: String(next.rate),
          valueDelta: String(valueDelta),
          postedAt: RECON_DATE,
        };
      });
      await tx.insert(stkLedger).values(adjLedgerRows);
      adjLedgerCount += adjLedgerRows.length;
    }

    // ── write final bins ─────────────────────────────────────────────────
    const binRows = insertedItems.map((row) => {
      const b = binState.get(row.id) ?? { ...EMPTY_BIN };
      return {
        orgId,
        itemId: row.id,
        warehouseId: warehouse.id,
        qty: String(b.qty),
        valuationRate: String(b.rate),
      };
    });
    await tx.insert(stkBins).values(binRows);

    // ── stk_consumption (not in the drizzle schema export yet — raw SQL
    // against the table the D1 migration already applied to prod) ────────
    const consumptionSeeded: { finProduct: string; item: string; qty: number }[] = [];
    for (const p of finProductRows) {
      const match = matchConsumption(p.name);
      if (!match) continue;
      const item = itemByName.get(match.itemName);
      if (!item) continue;
      const note = match.note ?? 'seed:heuristic';
      await tx.execute(sql`
        insert into stk_consumption (org_id, fin_product_id, item_id, qty_per_unit, note)
        values (${orgId}, ${p.id}, ${item.id}, ${match.qty}, ${note})
        on conflict (org_id, fin_product_id, item_id) do update set qty_per_unit = excluded.qty_per_unit, note = excluded.note, updated_at = now()
      `);
      consumptionSeeded.push({ finProduct: p.name, item: match.itemName, qty: match.qty });
    }

    console.log(`\nstk_consumption seeded (${consumptionSeeded.length} rows):`);
    console.log('fin_product'.padEnd(45) + 'item'.padEnd(32) + 'qty');
    for (const row of consumptionSeeded)
      console.log(row.finProduct.padEnd(45) + row.item.padEnd(32) + row.qty);

    console.log(
      `\nitems with no fin_product match (${nullFinMatches.length}): ${nullFinMatches.join(', ') || '(none)'}`,
    );
    console.log(
      `\nseeded: ${insertedItems.length} items, ${orderedKeys.length + adjEntryCount} entries (${adjEntryCount} reconciliation), ${ledgerRows.length + adjLedgerCount} ledger rows, ${consumptionSeeded.length} consumption mappings.`,
    );
  });

  // ── verification (post-commit read-back) ──────────────────────────────
  console.log('\n─── verification ───');
  const bins = await db.select().from(stkBins).where(eq(stkBins.orgId, orgId));
  const items = await db.select().from(stkItems).where(eq(stkItems.orgId, orgId));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const levelsByName = new Map(data.levels.map((l) => [l.name, l]));

  let mismatch = false;
  console.log('item'.padEnd(32) + 'expected'.padEnd(12) + 'actual'.padEnd(12) + 'ok?');
  for (const bin of bins) {
    const item = itemById.get(bin.itemId)!;
    const lvl = levelsByName.get(item.name);
    const expected = lvl ? lvl.units : null;
    const actual = Number(bin.qty);
    const ok = expected == null || Math.abs(actual - expected) < EPS;
    if (!ok) mismatch = true;
    console.log(
      item.name.padEnd(32) +
        String(expected ?? '(n/a)').padEnd(12) +
        String(actual).padEnd(12) +
        (ok ? 'OK' : 'MISMATCH'),
    );
  }

  const [{ count: ledgerCount }] = (await db.execute(
    sql`select count(*)::int as count from stk_ledger where org_id = ${orgId}`,
  )) as unknown as { count: number }[];
  const [{ count: entryCount }] = (await db.execute(
    sql`select count(*)::int as count from stk_entries where org_id = ${orgId}`,
  )) as unknown as { count: number }[];
  const [{ count: consumptionCount }] = (await db.execute(
    sql`select count(*)::int as count from stk_consumption where org_id = ${orgId}`,
  )) as unknown as { count: number }[];
  console.log(
    `\nledger rows: ${ledgerCount}   entries: ${entryCount}   consumption mappings: ${consumptionCount}   items: ${items.length}`,
  );

  if (mismatch) {
    console.error('\nFAIL: bin qty mismatch(es) above.');
    process.exit(1);
  }
  console.log('\nOK: all bin quantities match export(1) units.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
