#!/usr/bin/env bun
/**
 * FACES catalog cleanup — one-shot, IDEMPOTENT, transactional.
 *
 *   bun scripts/faces-catalog-cleanup.ts            # dry run (default), prints the plan
 *   bun scripts/faces-catalog-cleanup.ts --apply    # executes inside ONE transaction
 *
 * Decisions encoded here come from the user's answers to
 * specs/2026-07-25-faces-catalog-cleanup-report.md §9. Every destructive step is
 * a DEACTIVATE + ALIAS, never a delete:
 *
 *   · the loser row stays (so 8 tables' foreign keys and all history survive),
 *   · its `sku` is repointed at the keeper's sku  → they are one logical product,
 *   · its code is appended to the keeper's `metadata.aliases` → `loadProductMap`
 *     and `importFromBilling` keep resolving it, so the merge survives both the
 *     nightly SUSII sync and a manual "import from billing".
 *
 * Re-runnable: every statement is guarded on its own post-condition, so a second
 * run is a no-op rather than a double-apply.
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { codeError } from '../src/lib/catalog/code';

const APPLY = process.argv.includes('--apply');
const ORG = '21e0601b-f632-43fd-8414-d644af4271f4';

const url =
  process.env.SUPABASE_DB_URL ??
  (
    readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(
      /^SUPABASE_DB_URL=(.*)$/m,
    )?.[1] ?? ''
  )
    .trim()
    .replace(/^["']|["']$/g, '');
if (!url) throw new Error('SUPABASE_DB_URL not found');

/** loser code → keeper code. Loser is deactivated + aliased onto the keeper. */
const MERGES: Array<{ keeper: string; losers: string[]; why: string }> = [
  { keeper: 'CMSVP', losers: ['CM-SVP'], why: '§1a identical name+price, 0 refs' },
  { keeper: 'RSSVP', losers: ['RS-SVP'], why: '§1a' },
  { keeper: 'RO4', losers: ['RS-O4'], why: '§1a' },
  { keeper: 'RO', losers: ['RO-I', 'FACES 6244'], why: '§1a + §1b (RO has 218 invoices)' },
  { keeper: 'LIO990', losers: ['LO1', 'LIO1'], why: '§1b all three map to HA Opera I qty 5' },
  { keeper: 'OOI', losers: ['OO1 990'], why: '§1b OOI has 64 invoices vs 13' },
  { keeper: 'T1Z', losers: ['FACES 4788'], why: '§2b BOTOX 1 zona == Toxina 1 Zona' },
  { keeper: 'LLM', losers: ['LM'], why: '§2b same procedure, neither records an insumo' },
];

/**
 * code → { name?, newCode?, category? }.
 *
 * Naming law applied throughout (user §2b "standardize product names"):
 *   MALAR/Malar → Pómulo · Jawline → Contorno Mandibular · Lips → Labios
 *   Menton → Mentón · Surco → Surcos · Linea(s) → Líneas · SHOUTING → Title Case
 * A bare brand with no variant recorded gets the "(variante)" suffix (§2a).
 */
const EDITS: Record<string, { name?: string; newCode?: string; category?: string }> = {
  // ── §1c: the code preserved a generation the name had lost ────────────────
  MO3: { name: 'Mentón (Opera III)' },
  SO3: { name: 'Surcos (Opera III)' },

  // ── §2a bare-variant products: kept, made explicit ────────────────────────
  LO: { name: 'Labios Opera (variante)' },
  OjO: { name: 'Ojeras Opera (variante)', newCode: 'OJO' },
  MO: { name: 'Mentón Opera (variante)' },
  SO: { name: 'Surcos Opera (variante)' },
  RO: { name: 'Rino Opera (variante)' },
  L02: { name: 'Labios Sculpt Saypha (variante)' },
  O02: { name: 'Ojeras Saypha (variante)' },
  M02: { name: 'Mentón Saypha (variante)' },
  MS: { name: 'Pómulo Saypha (variante)' },
  SS: { name: 'Surcos Saypha (variante)' },
  R02: { name: 'RinoSculpt Saypha (variante)' },
  LLM: { name: 'Líneas de Marioneta (variante)' },

  // ── §2b keep-both pairs, distinguished by what they consume ───────────────
  // "same procedure, different stock items used"
  ML: { name: 'Pómulo (variante)' },
  M5: { name: 'Pómulo MIFILL' },
  M6: { name: 'Pómulo (variante 2)' },
  CM: { name: 'Contorno Mandibular (variante)' },
  J02: { name: 'Contorno Mandibular Saypha (variante)' },
  // "same region, different procedure" — NOT merged
  LDP: { name: 'Labios Deep' },
  L01: { name: 'Labios Sculpt MIFILL' },
  // "same product at 2 tiers" — stem unified so they group together
  AF1: { name: 'Afinamiento de Rostro (completo)' },
  AF2: { name: 'Afinamiento de Rostro (básico)' },

  // ── remaining Lips/Menton/Surco/Malar standardisation ─────────────────────
  LIO990: { name: 'Labios (Opera I)', newCode: 'LO1' }, // LO1 freed by the merge
  LO2: { name: 'Labios (Opera II)' },
  LSSV: { name: 'Labios Sculpt - Saypha Volume' },
  SFL: { name: 'Saypha Filler Labios' },
  MASVP: { name: 'Pómulo - Saypha Volume Plus', newCode: 'MASP' },
  MLO4: { name: 'Pómulo (Opera IV)' },
  MSVP: { name: 'Mentón - Saypha Volume Plus' },
  M01: { name: 'Mentón MIFILL' },
  MO4: { name: 'Mentón (Opera IV)' },
  M4: { name: 'Surcos MIFILL' },
  SO4: { name: 'Surcos (Opera IV)' },
  SSV: { name: 'Surcos - Saypha Volume' },
  SSVP: { name: 'Surcos - Saypha Volume Plus' },
  LMSVP: { name: 'Líneas de Marioneta (Saypha Volume Plus)', newCode: 'LMSP' },
  LMO3: { name: 'Líneas de Marioneta (Opera III)' },
  O01: { name: 'Ojeras MIFILL' },
  R01: { name: 'RinoSculpt MIFILL' },
  RO4: { name: 'RinoSculpt (Opera IV)' },
  RSSVP: { name: 'RinoSculpt - Saypha Volume Plus', newCode: 'RSSP' },
  CMSVP: { name: 'Contorno Mandibular (Saypha Volume Plus)', newCode: 'CMSP' },
  CMO4: { name: 'Contorno Mandibular (Opera IV)' },

  // ── §6/§9.4 remaining code-format violations ──────────────────────────────
  H: { name: 'Hialuronidasa', newCode: 'HIAL' },
  NCTF3: { name: 'NCTF-3s', newCode: 'NCTF' },
  'F-G': { name: 'Faja G', newCode: 'FAJG', category: 'Prenda' },

  // ── §2c retail, separated from clinical services ──────────────────────────
  EU: { name: 'Eudaria', category: 'Retail' },
  JIEU: { name: 'Jabón Íntimo Eudaria', category: 'Retail' },
  DQ: { name: 'Dermaquench', category: 'Retail' },
  LB: { name: 'Lifting B', category: 'Retail' },
  WS: { name: 'Watershield', category: 'Retail' },
  JB: { name: 'Sensiclean', newCode: 'SENS', category: 'Retail' },
  LD: { name: 'Lip Defender', category: 'Retail' }, // §5 gifted → price stays null
};

/** §5 + §9.6 — inactive but still being billed. Flip back on. */
const ACTIVATE = ['BC', 'DQ', 'H', 'LB', 'JB', 'WS'];

/**
 * §2c — AJ "Ajuste por Método de Pago" is a payment SURCHARGE, not something
 * sold. It becomes `pos_settings.surcharges`; the product is retired so it stops
 * polluting the catalog, but is kept + aliased so its 8 historical invoice lines
 * still resolve.
 */
const RETIRE_AS_SETTING = ['AJ'];

/** §4 — FAJA sizes are stocked separately and added as part of procedures. */
const FAJA_SIZES = [
  { code: 'FAJS', name: 'Faja S', item: '1276' },
  { code: 'FAJM', name: 'Faja M', item: '1277' },
  { code: 'FAJL', name: 'Faja L', item: '1278' },
];

/**
 * §2c "make sure they're stock items as well where needed" — retail goods that
 * are sold but had no stk_items row, so a sale decremented nothing. Codes follow
 * the new 2-4 alnum rail (the numeric 12xx codes are inherited SUSII ids; new
 * items should not fake one).
 */
const RETAIL_ITEMS: Array<{ product: string; code: string; name: string; group: string }> = [
  { product: 'EU', code: 'EUDA', name: 'Eudaria', group: 'Cosméticos' },
  { product: 'JIEU', code: 'JIEU', name: 'Jabón Íntimo Eudaria', group: 'Cosméticos' },
  // Faja G is the 4th size; S/M/L already exist as 1276/1277/1278.
  { product: 'FAJG', code: 'FAJG', name: 'Faja G', group: 'Insumos Internos' },
];

/**
 * §5 "seed the procedures with stocked items based on your judgement", bounded
 * by §9.5 "leave unknowns alone if you can't judge what they consume".
 *
 * Only three of the 31 unmapped products clear that bar:
 *   · MO3 / SO3 — the user CONFIRMED these are Opera III (§9.3), and every
 *     other Opera product in this org consumes 5 of its generation's box.
 *   · SG "Sonrisa Gingival" — unambiguously a botulinum procedure, and every
 *     single-zone toxin product here is mapped at 30 units.
 *
 * Everything else is deliberately left alone. In particular the six MIFILL
 * products (L01, M01, O01, M4, M5, R01 — 229 and 244 invoices on two of them)
 * CANNOT be mapped: there is no MIFILL stock item at all. That is a stock gap
 * to fill, not a mapping to guess.
 */
const CONSUMPTION_SEED: Array<{ product: string; item: string; qty: number; why: string }> = [
  { product: 'MO3', item: '1257', qty: 5, why: 'Opera III confirmed; siblings use 5' },
  { product: 'SO3', item: '1257', qty: 5, why: 'Opera III confirmed; siblings use 5' },
  { product: 'SG', item: '1258', qty: 30, why: 'toxin procedure; org convention is 30u/zone' },
];

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(s);
};

try {
  // Validate the plan BEFORE touching anything: a bad target code would be a
  // permanent business key.
  const bad = Object.entries(EDITS)
    .filter(([, e]) => e.newCode && codeError(e.newCode))
    .map(([c, e]) => `${c} → ${e.newCode} (${codeError(e.newCode!)})`);
  const badFaja = FAJA_SIZES.filter((f) => codeError(f.code)).map((f) => f.code);
  if (bad.length || badFaja.length)
    throw new Error(`invalid target codes: ${[...bad, ...badFaja].join(', ')}`);

  const before = await sql`
    select code, name, active, unit_price, category, sku, metadata
    from fin_products where org_id = ${ORG} order by code`;
  const byCode = new Map(before.map((r) => [String(r.code), r]));
  say(
    `catalog: ${before.length} products, ${new Set(before.map((r) => String(r.sku))).size} distinct skus\n`,
  );

  /*
   * Referential sanity. A plan code counts as PRESENT if it is either still a
   * live code, or already consumed by a previous run — i.e. it now exists as an
   * alias on some product, or as a '#'-retired shell. Without that second
   * clause the script is single-use: after the first apply the old codes are
   * gone by design and a re-run aborts, which is the opposite of idempotent.
   */
  const aliasOwned = new Set<string>();
  for (const r of before) {
    const a = (r.metadata as { aliases?: unknown } | null)?.aliases;
    if (Array.isArray(a)) for (const c of a) aliasOwned.add(String(c));
    const code = String(r.code);
    if (code.startsWith('#')) aliasOwned.add(code.slice(1));
  }
  const named = [
    ...MERGES.flatMap((m) => [m.keeper, ...m.losers]),
    ...Object.keys(EDITS),
    ...ACTIVATE,
    ...RETIRE_AS_SETTING,
  ];
  const seen = [...new Set(named)];
  const done = seen.filter((c) => !byCode.has(c) && aliasOwned.has(c));
  const missing = seen.filter((c) => !byCode.has(c) && !aliasOwned.has(c));
  if (missing.length)
    throw new Error(`plan references codes that do not exist: ${missing.join(', ')}`);
  if (done.length)
    say(`already applied (code retired/aliased by a previous run): ${done.join(', ')}\n`);

  say('── MERGES (loser deactivated + sku repointed + code aliased onto keeper) ──');
  for (const m of MERGES) {
    say(`  ${m.keeper.padEnd(8)} ← ${m.losers.join(', ').padEnd(24)} ${m.why}`);
  }
  say('\n── EDITS ──');
  for (const [code, e] of Object.entries(EDITS)) {
    const cur = byCode.get(code);
    if (!cur) continue; // already applied on a previous run
    const bits = [
      e.name && e.name !== String(cur.name) ? `name "${cur.name}" → "${e.name}"` : null,
      e.newCode && e.newCode !== code ? `code ${code} → ${e.newCode}` : null,
      e.category && e.category !== cur.category ? `category → ${e.category}` : null,
    ].filter(Boolean);
    if (bits.length) say(`  ${code.padEnd(11)} ${bits.join(' · ')}`);
  }
  say(`\n── ACTIVATE ── ${ACTIVATE.join(', ')}`);
  say(`── RETIRE AS SETTING ── ${RETIRE_AS_SETTING.join(', ')} (→ pos_settings.surcharges)`);
  say(
    `── NEW FAJA PRODUCTS ── ${FAJA_SIZES.map((f) => `${f.code} "${f.name}" → item ${f.item}`).join(' · ')}`,
  );
  say(
    `── NEW RETAIL STOCK ITEMS ── ${RETAIL_ITEMS.map((r) => `${r.code} for product ${r.product}`).join(' · ')}`,
  );
  say('── CONSUMPTION SEED ──');
  for (const c of CONSUMPTION_SEED)
    say(`  ${c.product.padEnd(5)} → item ${c.item} x${c.qty}   (${c.why})`);

  if (!APPLY) {
    say('\nDRY RUN — nothing written. Re-run with --apply to execute.');
    await sql.end();
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`select set_config('app.current_org_id', ${ORG}, true)`;

    // ── 0. activate ── FIRST, because steps 1-2 rewrite some of these codes
    //       (H → HIAL, JB → SENS) and matching after the rename would silently
    //       leave those two products inactive.
    await tx`update fin_products set active=true, updated_at=now()
             where org_id=${ORG} and code = any(${ACTIVATE})`;

    // ── 1. merges ──────────────────────────────────────────────────────────
    for (const m of MERGES) {
      // Resolve by live code OR by alias: a previous run may already have
      // renamed the keeper (CMSVP → CMSP), in which case the plan's code now
      // lives in that product's aliases.
      const [keeper] = await tx`
        select id, sku from fin_products
        where org_id=${ORG}
          and (code=${m.keeper}
               or (jsonb_typeof(metadata->'aliases')='array'
                   and metadata->'aliases' @> to_jsonb(${m.keeper}::text)))
        order by active desc limit 1`;
      if (!keeper) continue;
      for (const loser of m.losers) {
        /*
         * Two guards, both hit on a RE-RUN:
         *  · `id <> keeper.id` — a keeper may have ADOPTED a freed loser code
         *    (LIO990 took 'LO1'), so a naive code lookup finds the keeper and
         *    tries to retire it into a '#LO1' that already exists;
         *  · `mergedInto is null` — skip shells a previous run already merged.
         */
        const [l] = await tx`select id from fin_products
                             where org_id=${ORG} and code=${loser}
                               and id <> ${keeper.id}
                               and metadata->>'mergedInto' is null`;
        if (!l) continue;
        // Repoint every soft reference. stk_consumption is COLLAPSED, not
        // repointed: keeper and loser map to the same item at the same qty and
        // the table is unique on (org, product, item), so a repoint would raise
        // a unique violation.
        await tx`delete from stk_consumption c where c.org_id=${ORG} and c.fin_product_id=${l.id}
                 and exists (select 1 from stk_consumption k where k.org_id=${ORG}
                             and k.fin_product_id=${keeper.id} and k.item_id=c.item_id)`;
        await tx`update stk_consumption set fin_product_id=${keeper.id} where org_id=${ORG} and fin_product_id=${l.id}`;
        await tx`update fin_invoice_items set product_id=${keeper.id} where org_id=${ORG} and product_id=${l.id}`;
        await tx`update pos_ticket_lines   set fin_product_id=${keeper.id} where org_id=${ORG} and fin_product_id=${l.id}`;
        await tx`update sales_orders       set product_id=${keeper.id} where org_id=${ORG} and product_id=${l.id}`;
        await tx`update sched_bookings     set product_id=${keeper.id} where org_id=${ORG} and product_id=${l.id}`;
        await tx`update sched_event_types  set product_id=${keeper.id} where org_id=${ORG} and product_id=${l.id}`;
        await tx`update stk_accruals       set fin_product_id=${keeper.id} where org_id=${ORG} and fin_product_id=${l.id}`;
        await tx`update stk_items          set fin_product_id=${keeper.id} where org_id=${ORG} and fin_product_id=${l.id}`;
        // Loser becomes an inactive shell pointing at the keeper's sku.
        await tx`update fin_products set active=false, sku=${keeper.sku}, updated_at=now(),
                   metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('mergedInto', ${keeper.id}::text)
                 where org_id=${ORG} and id=${l.id}`;
        // ★ Retire the loser's own code behind a '#' prefix. Two reasons:
        //   1. loadProductMap ranks a LIVE code above an alias, so an untouched
        //      loser code would keep resolving to the dead row and defeat the
        //      merge entirely;
        //   2. it frees the string, so a keeper may adopt it (LIO990 → LO1).
        // '#' is deliberately outside the 2-4 alnum rail: these rows are
        // inactive shells, never edited through the UI, and the prefix makes
        // "this was merged away" obvious in a raw table dump.
        await tx`update fin_products set code = '#' || code, updated_at=now()
                 where org_id=${ORG} and id=${l.id} and code not like '#%'`;
        // Keeper absorbs the loser's code as an alias (idempotent).
        await tx`update fin_products set updated_at=now(),
                   metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{aliases}',
                     coalesce(metadata->'aliases','[]'::jsonb) ||
                     case when coalesce(metadata->'aliases','[]'::jsonb) @> to_jsonb(${loser}::text)
                          then '[]'::jsonb else to_jsonb(array[${loser}::text]) end)
                 where org_id=${ORG} and id=${keeper.id}`;
      }
    }

    // ── 2. edits (name / code / category). A code change carries the OLD code
    //       into aliases, which is what keeps the SUSII sync resolving it. ────
    for (const [code, e] of Object.entries(EDITS)) {
      const [row] =
        await tx`select id, code from fin_products where org_id=${ORG} and code=${code}`;
      if (!row) continue;
      if (e.name)
        await tx`update fin_products set name=${e.name}, updated_at=now() where id=${row.id}`;
      if (e.category)
        await tx`update fin_products set category=${e.category}, updated_at=now() where id=${row.id}`;
      if (e.newCode && e.newCode !== code) {
        await tx`update fin_products set updated_at=now(),
                   metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{aliases}',
                     coalesce(metadata->'aliases','[]'::jsonb) ||
                     case when coalesce(metadata->'aliases','[]'::jsonb) @> to_jsonb(${code}::text)
                          then '[]'::jsonb else to_jsonb(array[${code}::text]) end)
                 where id=${row.id}`;
        await tx`update fin_products set code=${e.newCode}, updated_at=now() where id=${row.id}`;
      }
    }

    // ── 4. AJ → pos_settings.surcharges, product retired ───────────────────
    await tx`insert into pos_settings (org_id) values (${ORG}) on conflict (org_id) do nothing`;
    await tx`update pos_settings set updated_at=now(),
               methods = methods,
               surcharges = coalesce(surcharges, '{}'::jsonb) ||
                 jsonb_build_object('card', jsonb_build_object('type','fixed','amount',10,'label','Ajuste por método de pago'))
             where org_id=${ORG}`;
    for (const code of RETIRE_AS_SETTING) {
      await tx`update fin_products set active=false, updated_at=now(),
                 metadata = coalesce(metadata,'{}'::jsonb) || '{"retiredAs":"pos_settings.surcharges"}'::jsonb
               where org_id=${ORG} and code=${code}`;
    }

    // ── 5. FAJA sizes as their own sellables, linked to their stock items ───
    for (const f of FAJA_SIZES) {
      const [item] =
        await tx`select id, fin_product_id from stk_items where org_id=${ORG} and code=${f.item}`;
      if (!item) continue;
      if (item.fin_product_id) continue; // already published
      const [p] = await tx`
        insert into fin_products (org_id, code, name, category, active)
        values (${ORG}, ${f.code}, ${f.name}, 'Prenda', true)
        on conflict (org_id, code) do update set name=excluded.name
        returning id`;
      await tx`update stk_items set fin_product_id=${p.id}, updated_at=now() where id=${item.id}`;
    }

    // ── 6. retail goods that were sold without any stock row behind them ────
    for (const r of RETAIL_ITEMS) {
      const [p] = await tx`select id from fin_products where org_id=${ORG} and code=${r.product}`;
      if (!p) continue;
      const [linked] =
        await tx`select id from stk_items where org_id=${ORG} and fin_product_id=${p.id}`;
      if (linked) continue; // already backed
      await tx`
        insert into stk_items (org_id, code, name, uom, item_group, is_stock_item, fin_product_id)
        values (${ORG}, ${r.code}, ${r.name}, 'Unidad', ${r.group}, true, ${p.id})
        on conflict (org_id, code) do update set fin_product_id = excluded.fin_product_id`;
    }

    // ── 7. consumption mappings we can defend ──────────────────────────────
    for (const c of CONSUMPTION_SEED) {
      const [p] = await tx`select id from fin_products where org_id=${ORG} and code=${c.product}`;
      const [i] = await tx`select id from stk_items where org_id=${ORG} and code=${c.item}`;
      if (!p || !i) continue;
      await tx`
        insert into stk_consumption (org_id, fin_product_id, item_id, qty_per_unit)
        values (${ORG}, ${p.id}, ${i.id}, ${String(c.qty)})
        on conflict (org_id, fin_product_id, item_id) do nothing`;
    }
  });

  say('\nAPPLIED.');
} finally {
  await sql.end();
}
