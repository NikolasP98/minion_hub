#!/usr/bin/env bun
/**
 * Void real (prod, accepted) SUNAT documents ahead of
 * scripts/sweep-hub-transactions.ts, which refuses to touch pos_emissions
 * rows with environment='prod' AND status='accepted' — those are legally
 * real comprobantes; deleting the DB row does not void them at SUNAT.
 *
 *   bun scripts/sunat-baja-hub-emissions.ts            # dry run (read-only), every org
 *   bun scripts/sunat-baja-hub-emissions.ts --org <id> # one org
 *   bun scripts/sunat-baja-hub-emissions.ts --apply    # REFUSES — see below
 *
 * Per SUNAT rules encoded in src/server/finance/emission/summary.ts:
 *   - facturas (docType '01') void via a comunicación de baja (RA) — buildBajaXml/submitBaja.
 *   - boletas  (docType '03') void via a resumen diario (RC) with estado '3' — buildResumenXml/submitResumen.
 * These are NOT interchangeable (summary.ts throws a runtime guard either way).
 *
 * ---------------------------------------------------------------------------
 * WHY --apply IS A HARD NO-OP RIGHT NOW (read before "fixing" this):
 *
 * 1. No prod SUNAT credentials/endpoint exist anywhere in this codebase.
 *    `src/server/finance/emission/soap.ts` only exports SUNAT_BETA_ENDPOINT /
 *    SUNAT_BETA_USERNAME / SUNAT_BETA_PASSWORD (public MODDATOS sandbox
 *    values). `pos-emission.service.ts` only reads
 *    POS_EMISSION_BETA_CERT/POS_EMISSION_BETA_KEY. There is no
 *    POS_EMISSION_PROD_* equivalent, and pos_settings.emission's own comment
 *    says prod mode "doesn't exist yet" / is rejected by validation.
 *
 * 2. Worse: `submitBaja` and `submitResumen`
 *    (src/server/finance/emission/index.ts) HARDCODE
 *    SUNAT_BETA_USERNAME/SUNAT_BETA_PASSWORD internally and never pass an
 *    `endpoint` override to `sendSummary`. Calling them with a real prod
 *    cert would sign a legitimate-looking baja/resumen XML and then submit
 *    it to the BETA SANDBOX under test credentials — silently doing nothing
 *    real while looking like it worked. Wiring this script's --apply through
 *    the existing functions as-is would be actively misleading, not just
 *    incomplete.
 *
 * 3. `buildResumenXml` (needed for every boleta) requires a full
 *    `EmissionInvoice` (all line items + IGV rate) to call `computeTotals` —
 *    `pos_emissions` only stores the summary total, not line items. No
 *    function in this codebase reconstructs an `EmissionInvoice` from a
 *    `pos_tickets`/`pos_ticket_lines` row after the fact.
 *
 * None of this is a "add a null check" gap — it's unbuilt production
 * capability (prod SUNAT config source, endpoint/credential threading in
 * submitBaja/submitResumen, historical-invoice reconstruction for RC). See
 * the TODO(handoff) markers below; file a meta-repo `proposals/` entry for
 * this per AGENTS.md's open-items ledger rule before anyone attempts --apply
 * (this worktree cannot write to the meta-repo). Building those is a real
 * feature slice, not something to improvise inside a cleanup script — so
 * --apply here throws immediately.
 * ---------------------------------------------------------------------------
 */
import postgres from 'postgres';

export interface Args {
  apply: boolean;
  org: string | null;
}

export function parseArgs(argv: string[]): Args {
  const orgIdx = argv.indexOf('--org');
  return { apply: argv.includes('--apply'), org: orgIdx >= 0 ? (argv[orgIdx + 1] ?? null) : null };
}

export interface ProdEmissionRow {
  org_id: string;
  doc_type: string;
  serie: string;
  correlativo: number;
  total: string | null;
  created_at: Date;
  client_doc_type: string | null;
  client_doc_number: string | null;
}

/** '01' facturas void via baja (RA); everything else (boletas, '03') void via resumen estado-3 (RC). */
export function groupByVoidMethod(rows: ProdEmissionRow[]): {
  baja: ProdEmissionRow[];
  resumenEstado3: ProdEmissionRow[];
} {
  return {
    baja: rows.filter((r) => r.doc_type === '01'),
    resumenEstado3: rows.filter((r) => r.doc_type !== '01'),
  };
}

async function listProdAccepted(
  client: postgres.Sql,
  orgIds: string[] | null,
): Promise<ProdEmissionRow[]> {
  const rows = orgIds
    ? await client<ProdEmissionRow[]>`
        select org_id, doc_type, serie, correlativo, total, created_at, client_doc_type, client_doc_number
        from pos_emissions
        where org_id = any(${orgIds}) and environment = 'prod' and status = 'accepted'
        order by org_id, doc_type, serie, correlativo`
    : await client<ProdEmissionRow[]>`
        select org_id, doc_type, serie, correlativo, total, created_at, client_doc_type, client_doc_number
        from pos_emissions
        where environment = 'prod' and status = 'accepted'
        order by org_id, doc_type, serie, correlativo`;
  return rows as unknown as ProdEmissionRow[];
}

async function dryRun(client: postgres.Sql, org: string | null): Promise<void> {
  const rows = await listProdAccepted(client, org ? [org] : null);
  if (!rows.length) {
    console.log('No prod-accepted SUNAT emissions found — nothing to void.');
    return;
  }
  const { baja, resumenEstado3 } = groupByVoidMethod(rows);
  console.log(`${rows.length} prod-accepted emission(s):\n`);
  console.log(`-- facturas (01) — void via comunicación de baja (RA): ${baja.length} --`);
  for (const r of baja) {
    console.log(
      `  ${r.org_id}  ${r.serie}-${r.correlativo}  total=${r.total}  ${r.created_at.toISOString()}  client=${r.client_doc_type ?? '-'}:${r.client_doc_number ?? '-'}`,
    );
  }
  console.log(
    `\n-- boletas (03, or anything not '01') — void via resumen estado-3 (RC): ${resumenEstado3.length} --`,
  );
  for (const r of resumenEstado3) {
    console.log(
      `  ${r.org_id}  ${r.serie}-${r.correlativo}  total=${r.total}  ${r.created_at.toISOString()}  client=${r.client_doc_type ?? '-'}:${r.client_doc_number ?? '-'}`,
    );
  }
  console.log(
    "\n--apply is currently a hard no-op — see this file's header for exactly what production code is missing (prod SUNAT credentials, endpoint threading in submitBaja/submitResumen, EmissionInvoice reconstruction for RC).",
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL not set (check .env.local) — refusing to run.');
  const client = postgres(url, { prepare: false, max: 5 });

  try {
    if (args.apply) {
      // TODO(handoff): --apply is intentionally unimplemented. Building it
      // needs, in order: (1) a real POS_EMISSION_PROD_CERT/KEY + prod RUC
      // SOL credentials + prod endpoint sourced from org config (not
      // hardcoded, unlike beta); (2) `submitBaja`/`submitResumen` in
      // src/server/finance/emission/index.ts threading `endpoint`/
      // `username`/`password` through to `sendSummary` instead of hardcoding
      // SUNAT_BETA_USERNAME/PASSWORD; (3) a function that reconstructs a
      // full `EmissionInvoice` (all lines + igvRate) from a `pos_tickets` /
      // `pos_ticket_lines` row for the RC estado-3 path's `computeTotals`
      // call. Needs a meta-repo proposals/ entry (see file header).
      throw new Error(
        '--apply is not implemented: prod SUNAT credentials/endpoint and EmissionInvoice ' +
          'reconstruction for the RC estado-3 (boleta) path do not exist in this codebase yet. ' +
          'See the header comment in this file. Run without --apply for the read-only listing.',
      );
    }
    await dryRun(client, args.org);
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.main) await main();
