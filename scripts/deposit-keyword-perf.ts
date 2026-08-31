/**
 * S3 perf ship gate of `2026-08-17-hub-reserva-keyword-config-spec`:
 * `explain analyze` the finance classification query at 1 keyword and at N,
 * and decide whether `DEPOSIT_KEYWORDS_MAX` is a safe cap.
 *
 *   bun run scripts/deposit-keyword-perf.ts            # default 120k line items
 *   DEPOSIT_PERF_ITEMS=400000 bun run scripts/deposit-keyword-perf.ts
 *
 * WHY A SYNTHETIC DATABASE. The gate as written in the spec wants the largest
 * dev org. No hub environment that runs agents has PostgreSQL credentials (see
 * the S0 actuals), so this measures the same query shape on a real PostgreSQL
 * ENGINE — `@electric-sql/pglite`, the same engine the CRM suites already use
 * for planner-faithful checks — over a synthetic table at a size stated in the
 * output. What transfers is the SHAPE of the cost curve (how execution time
 * grows with keyword count over an unindexed `description`), which is what the
 * cap is chosen from. What does NOT transfer is absolute latency: pglite is
 * single-threaded WASM with no parallel workers and no real I/O, so a server
 * seq scan is faster in absolute terms and can additionally parallelise —
 * both of which make the ratio measured here an UPPER bound (pessimistic),
 * not an optimistic one.
 *
 * The predicates come from the shipped `crm-deposit-rule.ts` builders, so the
 * thing measured is the SQL the services actually emit — never a hand-copied
 * approximation of it.
 */
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PGlite } from '@electric-sql/pglite';
import {
  depositMatchSql,
  notDepositMatchSql,
  DEPOSIT_KEYWORDS_MAX,
  type DepositRule,
} from '../src/server/services/crm-deposit-rule';

const dialect = new PgDialect();

/** Line descriptions of a Peruvian aesthetics clinic, deposits included —
 *  the vocabulary this rule exists to classify. */
const PROCEDURES = [
  'Botox 50 unidades',
  'Rinomodelacion con acido hialuronico',
  'Limpieza facial profunda',
  'Depilacion laser piernas completas',
  'Peeling quimico mediano',
  'Consulta dermatologica',
  'Plasma rico en plaquetas',
  'Mesoterapia capilar sesion 3',
  'Lipopapada enzimatica',
  'Relleno de ojeras',
];
const DEPOSITS = [
  'Reserva de cita',
  'Reserva procedimiento diciembre',
  'Adelanto por paquete facial',
];

/** The org's configured vocabulary at size `n`. The FIRST keyword is the one
 *  the data actually uses; the rest are the plausible synonyms an operator
 *  adds. That is the realistic worst case: a non-deposit line (the majority)
 *  must evaluate every `not ilike` before the `and` chain can conclude. */
function ruleOf(n: number): DepositRule {
  const extras = [
    'adelanto',
    'seña',
    'anticipo',
    'abono',
    'deposito',
    'separacion',
    'booking',
    'prepago',
    'inicial',
    'garantia',
    'apartado',
    'cuota inicial',
    'senia',
    'reserva parcial',
    'pago adelantado',
    'pago inicial',
    'reserva cita',
    'reserva online',
    'pre-pago',
  ];
  return { keywords: ['reserva', ...extras].slice(0, n), label: 'Reserva' };
}

/** The hot half of `CONTACT_INVOICE_CLASS` (crm-finance.service.ts): one
 *  deposit/procedure classification per invoice line, aggregated per invoice.
 *  The contact/party joins are omitted — they are keyword-independent fixed
 *  cost, and including them would only dilute the ratio being measured. */
function classifyQuery(rule: DepositRule) {
  return sql`
    select fi.id,
           bool_or(${depositMatchSql('ii.description', rule)}) has_deposit,
           bool_or((ii.description is not null and ${notDepositMatchSql('ii.description', rule)})) has_proc
    from fin_invoices fi
    join fin_clients fc on fc.id = fi.client_id
    left join fin_invoice_items ii on ii.invoice_id = fi.id
    where fi.shadowed = false
    group by fi.id`;
}

interface ExplainRow {
  'QUERY PLAN': [{ 'Execution Time': number; Plan: { 'Node Type': string } }];
}

async function executionMs(pg: PGlite, rule: DepositRule): Promise<number> {
  const { sql: text, params } = dialect.sqlToQuery(classifyQuery(rule));
  const res = await pg.query<ExplainRow>(`explain (analyze, format json) ${text}`, params);
  return res.rows[0]!['QUERY PLAN'][0]['Execution Time'];
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function main() {
  const items = Number(process.env.DEPOSIT_PERF_ITEMS ?? 120_000);
  const invoices = Math.round(items / 3);
  const clients = Math.round(invoices / 8);
  const runs = Number(process.env.DEPOSIT_PERF_RUNS ?? 5);

  const pg = new PGlite();
  await pg.exec(`
    create table fin_clients (id int primary key);
    create table fin_invoices (id int primary key, client_id int not null, shadowed boolean not null default false);
    create table fin_invoice_items (id int primary key, invoice_id int not null, description text, total numeric);
    create index on fin_invoices (client_id);
    create index on fin_invoice_items (invoice_id);
  `);
  // No index on `description` — that absence is the premise of the whole gate
  // (§1 of the spec verified it in prod), so seeding one would measure the
  // wrong database.
  await pg.exec(`insert into fin_clients select generate_series(1, ${clients})`);
  await pg.exec(
    `insert into fin_invoices select g, 1 + (g % ${clients}), false from generate_series(1, ${invoices}) g`,
  );
  const proc = PROCEDURES.map((d) => `'${d.replace(/'/g, "''")}'`).join(',');
  const dep = DEPOSITS.map((d) => `'${d.replace(/'/g, "''")}'`).join(',');
  // ~12% deposit lines, the rest procedures — a clinic books far more
  // procedures than it takes reservations.
  await pg.exec(`
    insert into fin_invoice_items
    select g,
           1 + (g % ${invoices}),
           case when g % 8 = 0 then (array[${dep}])[1 + (g % ${DEPOSITS.length})]
                else (array[${proc}])[1 + (g % ${PROCEDURES.length})] end,
           100
    from generate_series(1, ${items}) g;
    analyze;
  `);

  const sizes = (process.env.DEPOSIT_PERF_SIZES ?? `1,${DEPOSIT_KEYWORDS_MAX},20`)
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n, index, values) => n > 0 && values.indexOf(n) === index);
  console.log(
    `engine: pglite (PostgreSQL, single-threaded WASM) · rows: ${items} invoice items / ` +
      `${invoices} invoices / ${clients} clients · median of ${runs} runs after 1 warm-up`,
  );
  const results: { n: number; ms: number }[] = [];
  for (const n of sizes) {
    const rule = ruleOf(n);
    await executionMs(pg, rule); // warm-up: first touch pages the heap in
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) samples.push(await executionMs(pg, rule));
    results.push({ n, ms: median(samples) });
  }
  const base = results[0]!.ms;
  console.log('\nkeywords | median exec ms | ×1-keyword');
  for (const r of results) {
    console.log(
      `${String(r.n).padStart(8)} | ${r.ms.toFixed(1).padStart(14)} | ${(r.ms / base).toFixed(2)}×`,
    );
  }
  const reference = results.find((result) => result.n === 20) ?? results[results.length - 1]!;
  console.log(
    `\nship gate reference: ${reference.n} keywords costs ${(reference.ms / base).toFixed(2)}× one keyword — ` +
      `the spec lowers DEPOSIT_KEYWORDS_MAX if this exceeds ~2×.`,
  );
  await pg.close();
}

await main();
// PGlite's worker leaves Bun with exit code 99 after a clean close. Reaching
// this line means every setup/query/reporting await succeeded; thrown failures
// still bypass it and retain their non-zero exit.
process.exit(0);
