/**
 * Remove from a PACKAGE's own `stk_consumption` every line that duplicates a
 * consumption of one of the services the package includes.
 *
 * Why: a package sells SESSIONS. Nothing is delivered when it is sold — the
 * sale mints one grant per included service, and the insumo is issued later,
 * through the base service, when a session is booked/completed. A pack that
 * ALSO carries the base service's consumption issues that insumo twice: once
 * at the counter and once at delivery. FACES "Afinamiento de Rostro
 * (completo)" (SKU-AF1) is the live instance: it re-declares the 6 ml of Acido
 * Desoxicolico that "Afinamiento Facial (individual)" (SKU-AF2) already
 * consumes. The write path now refuses new ones (`blockedPackageConsumption`
 * in src/lib/components/pos/composition.ts); this clears the rows that predate
 * the rule.
 *
 * A pack's remaining consumption lines — insumos no included service consumes
 * — are left alone: those are the physical products the pack hands over, and
 * issuing them at sale is correct.
 *
 * SAFE BY DEFAULT: dry-run prints every affected row and writes nothing.
 * Idempotent — a second run finds nothing left to delete.
 *
 * Run:
 *   bun run scripts/clean-package-duplicate-consumption.ts [orgId] [--apply]
 *   (orgId defaults to the FACES org)
 */
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const orgId = args.find((a) => !a.startsWith('--')) ?? FACES_ORG;

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set (check .env.local)');
const sql = postgres(url, { prepare: false, max: 5 });

interface Dup {
  consumption_id: string;
  pack_code: string;
  pack_name: string;
  item_code: string;
  item_name: string;
  qty_per_unit: string;
  via_code: string;
  via_name: string;
}

/** The pack's own consumption row AND the included service that already owns it. */
const duplicates = () => sql<Dup[]>`
  select c.id            as consumption_id,
         pack.code       as pack_code,
         pack.name       as pack_name,
         it.code         as item_code,
         it.name         as item_name,
         c.qty_per_unit  as qty_per_unit,
         child.code      as via_code,
         child.name      as via_name
  from stk_consumption c
  join fin_products pack on pack.id = c.fin_product_id and pack.org_id = c.org_id
  join fin_product_components bc
    on bc.bundle_product_id = c.fin_product_id and bc.org_id = c.org_id
  join stk_consumption cc
    on cc.fin_product_id = bc.child_product_id and cc.item_id = c.item_id and cc.org_id = c.org_id
  join fin_products child on child.id = bc.child_product_id and child.org_id = bc.org_id
  join stk_items it on it.id = c.item_id and it.org_id = c.org_id
  where c.org_id = ${orgId}
  order by pack.code, it.code`;

async function main() {
  const rows = await duplicates();
  console.log(`\norg ${orgId} — ${apply ? 'APPLY' : 'DRY-RUN'}\n`);
  if (!rows.length) {
    console.log('No package re-declares an included service’s consumption. Nothing to do.\n');
    return;
  }
  console.log('pack      insumo                         qty   already consumed by');
  console.log('─'.repeat(88));
  for (const r of rows) {
    console.log(
      `${r.pack_code.padEnd(9)} ${`${r.item_code} ${r.item_name}`.slice(0, 30).padEnd(30)} ${String(r.qty_per_unit).padStart(5)}   ${r.via_code} ${r.via_name}`,
    );
  }
  console.log('─'.repeat(88));
  // Distinct ids: one pack row can be covered by several included services.
  const ids = [...new Set(rows.map((r) => r.consumption_id))];
  console.log(
    `${ids.length} consumption row(s) to delete across ${new Set(rows.map((r) => r.pack_code)).size} package(s)`,
  );

  if (!apply) {
    console.log('\nDry-run — nothing written. Re-run with --apply to delete.\n');
    return;
  }
  const deleted = await sql`
    delete from stk_consumption
    where org_id = ${orgId} and id = any(${sql.array(ids)}::uuid[])
    returning id`;
  console.log(`\nAPPLIED — deleted ${deleted.length} consumption row(s).\n`);

  const left = await duplicates();
  // Invariant, not a statement count: re-running must find nothing.
  if (left.length) throw new Error(`${left.length} duplicate row(s) survived the delete`);
  console.log('Invariant OK — no package re-declares an included service’s consumption.\n');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
