/**
 * ONE-TIME seed of the catalog sale price (`fin_products.unit_price`) for FACES
 * service products, derived from the SUSII invoice history.
 *
 * Why: fin_products (the shared catalog behind /finances/products AND /pos/catalog
 * — POS `listSellables` reads the same table) was imported with `unit_price = null`.
 * The POS sell screen charges `qty × unit_price` with NO tax added (pos.service
 * computeTicketTotals), so unit_price is the GROSS, tax-inclusive price the
 * customer pays.
 *
 * Price picked = the MODE of the net line-item unit_price (the most-frequently
 * charged price = the standard list price; median gets dragged by ad-hoc
 * discounts), grossed up by IGV: `round(mode(net) × 1.18, 2)`. Every FACES service
 * mode grosses to a clean round sol (42.37→50, 1355.93→1600, 677.97→800), which
 * confirms list prices are defined gross at 18% IGV.
 *
 * "Service product" = a fin_product with NO linked stk_items row (kind is derived
 * that way in pos.service mapSellableRow). Stock-backed products keep their price
 * from cost+markup, so they're skipped unless --all is passed.
 *
 * SAFE BY DEFAULT: dry-run (prints the plan, writes nothing). Only rows whose
 * unit_price IS NULL are touched, so a re-run never clobbers a hand-edited price.
 * Future prices flow through the hub UI (the products editor / POS wizard).
 *
 * Run:
 *   bun run scripts/seed-service-prices.ts [orgId] [--apply] [--all]
 *   (orgId defaults to the FACES org; --all also seeds stock-backed products)
 */
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const IGV = 1.18;
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const includeProducts = args.includes('--all');
const orgId = args.find((a) => !a.startsWith('--')) ?? FACES_ORG;

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set (check .env.local)');
const sql = postgres(url, { prepare: false, max: 5 });

const money = (n: number) => `S/ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Plan {
  id: string;
  code: string;
  name: string;
  kind: 'service' | 'product';
  nlines: number;
  net_mode: number | null;
  gross: number | null;
}

async function main() {
  // Per catalog product with no price yet: the modal net unit_price from its
  // matching invoice lines, grossed up by IGV. Left-joined so we still list
  // products that have no invoice history (gross = null → skipped).
  const rows = (await sql`
    with cat as (
      select p.id, p.code, p.name,
        (not exists (select 1 from stk_items i where i.fin_product_id = p.id and i.org_id = ${orgId})) as is_service
      from fin_products p
      where p.org_id = ${orgId} and p.active = true and p.unit_price is null
    )
    select c.id, c.code, c.name, c.is_service,
      count(it.*)::int as nlines,
      mode() within group (order by it.unit_price::numeric) as net_mode
    from cat c
    left join fin_invoice_items it
      on it.org_id = ${orgId} and it.code = c.code and it.unit_price::numeric > 0
    group by c.id, c.code, c.name, c.is_service
    order by c.is_service desc, nlines desc
  `) as unknown as Array<{ id: string; code: string; name: string; is_service: boolean; nlines: number; net_mode: string | null }>;

  const plans: Plan[] = rows
    .filter((r) => includeProducts || r.is_service)
    .map((r) => {
      const net = r.net_mode != null ? Number(r.net_mode) : null;
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        kind: r.is_service ? 'service' : 'product',
        nlines: r.nlines,
        net_mode: net,
        gross: net != null ? Math.round(net * IGV * 100) / 100 : null,
      };
    });

  const seedable = plans.filter((p) => p.gross != null);
  const skipped = plans.filter((p) => p.gross == null);

  console.log(`\norg ${orgId} — ${apply ? 'APPLY' : 'DRY-RUN'}${includeProducts ? ' (incl. stock products)' : ' (services only)'}\n`);
  console.log('code     name                             kind     lines   net mode →  GROSS price');
  console.log('─'.repeat(84));
  for (const p of seedable) {
    console.log(
      `${p.code.padEnd(8)} ${p.name.slice(0, 30).padEnd(30)} ${p.kind.padEnd(8)} ${String(p.nlines).padStart(4)}   ${money(p.net_mode!).padStart(11)} → ${money(p.gross!).padStart(11)}`,
    );
  }
  console.log('─'.repeat(84));
  console.log(`${seedable.length} products to price${skipped.length ? `, ${skipped.length} skipped (no invoice history): ${skipped.map((s) => s.code).join(', ')}` : ''}`);

  if (!apply) {
    console.log('\nDry-run — nothing written. Re-run with --apply to seed.\n');
    return;
  }

  await sql.begin(async (tx) => {
    for (const p of seedable) {
      // Guard `unit_price is null` again inside the tx: idempotent, never clobbers.
      await tx`update fin_products set unit_price = ${p.gross}, updated_at = now()
               where id = ${p.id} and org_id = ${orgId} and unit_price is null`;
    }
  });
  console.log(`\nAPPLIED — seeded unit_price on ${seedable.length} products.\n`);
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
