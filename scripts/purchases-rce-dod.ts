#!/usr/bin/env bun
/**
 * Live DoD script for specs/2026-08-14-purchases-rce-module-spec.md §5.2.
 *
 * READ-ONLY. Calls SUNAT's periods + resumen endpoints against the live SIRE
 * API using SUNAT_TEST_* creds. Never touches any RCE write endpoint (manual
 * §5.2-5.29 — aceptar/reemplazar propuesta, registrar preliminar,
 * importar/eliminar comprobantes). Paste this script's output in the PR.
 *
 * Run: bun scripts/purchases-rce-dod.ts
 */
import { SunatSireClient } from '../src/server/finance/connectors/sunat-sire-client';
// purchases.service.ts pulls in $server/* SvelteKit aliases at module scope,
// which plain `bun run` (no vite) can't resolve — this script runs standalone
// against the live API, so its two PURE helpers are duplicated inline rather
// than imported. Keep in sync with src/server/services/purchases.service.ts;
// purchases.service.test.ts is the source of truth these mirror.
function periodStatusFromDesEstado(desEstado: string): 'open' | 'closed' {
  return /^no/i.test(desEstado) ? 'open' : 'closed';
}
function parseResumenCsv(text: string) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.length > 0);
  const rows: Array<{ docTypeCode: string; docTypeLabel: string; count: number; baseGravada: number; igv: number; total: number }> = [];
  let totals = { docTypeCode: 'TOTAL', docTypeLabel: 'Total', count: 0, baseGravada: 0, igv: 0, total: 0 };
  for (const line of lines.slice(1)) {
    const cols = line.split('|');
    if (cols.length < 4) continue;
    const label = cols[0].trim();
    const count = Number(cols[1]) || 0;
    const baseGravada = Number(cols[2]) || 0;
    const igv = Number(cols[3]) || 0;
    const total = Number(cols[cols.length - 1]) || 0;
    if (/^total\b/i.test(label)) {
      totals = { docTypeCode: 'TOTAL', docTypeLabel: 'Total', count, baseGravada, igv, total };
      continue;
    }
    const m = /^(\d+)-(.*)$/.exec(label);
    rows.push({ docTypeCode: m ? m[1] : label, docTypeLabel: (m ? m[2] : label).trim(), count, baseGravada, igv, total });
  }
  return { rows, totals };
}

const ruc = process.env.SUNAT_TEST_RUC;
const username = process.env.SUNAT_TEST_USER;
const password = process.env.SUNAT_TEST_PASS;
const clientId = process.env.SUNAT_TEST_CLIENT_ID;
const clientSecret = process.env.SUNAT_TEST_CLIENT_SECRET;

if (!ruc || !username || !password || !clientId || !clientSecret) {
  console.error('Missing SUNAT_TEST_* env vars — see .env.example');
  process.exit(1);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  console.log('=== Purchases RCE DoD (spec §5.2) ===\n');

  const client = new SunatSireClient({ ruc: ruc!, username: username!, password: password!, clientId: clientId!, clientSecret: clientSecret! });

  console.log('--- 1. RCE periods (codLibro 080000) ---');
  const periods = await client.periodosRce();
  const current = periods.find((p) => p.perTributario === '202608');
  console.log(`total periods: ${periods.length}`);
  console.log(`202608 present: ${!!current} status: ${current?.desEstado} → ${current ? periodStatusFromDesEstado(current.desEstado) : 'n/a'}`);
  const presented = periods.filter((p) => periodStatusFromDesEstado(p.desEstado) === 'closed');
  console.log(`presented (closed) periods: ${presented.length} (e.g. ${presented[0]?.perTributario})`);

  await sleep(2000);

  console.log('\n--- 2. Resumen CSV for 202608 (propuesta) ---');
  const csv = await client.resumenComprobantes('202608', '1', '0');
  const { rows, totals } = parseResumenCsv(csv);
  console.log('raw CSV:');
  console.log(csv);
  console.log(`parsed ${rows.length} doc-type rows, totals: ${totals.count} docs / S/ ${totals.total.toFixed(2)}`);
  for (const r of rows) console.log(`  ${r.docTypeCode}-${r.docTypeLabel}: ${r.count} docs, base=${r.baseGravada}, igv=${r.igv}, total=${r.total}`);

  await sleep(2000);

  console.log('\n--- 3. Row-level export ticket + download quirk ---');
  try {
    const numTicket = await client.exportarPropuestaRce('202608');
    console.log(`export ticket: ${numTicket}`);
    await sleep(3000);
    const status = await client.consultaEstadoTicket('202608', '202608', numTicket);
    console.log(`ticket status: ${status?.desEstadoProceso}`);
    const archivo = status?.archivoReporte?.[0];
    if (archivo) {
      console.log(`generated file: ${archivo.nomArchivoReporte}`);
      await sleep(2000);
      const res = await client.descargarArchivoReporte(archivo.nomArchivoReporte, archivo.codTipoAchivoReporte);
      console.log(`download attempt: HTTP ${res.status}`);
      if (res.ok) {
        const text = await res.text();
        console.log('DOWNLOAD SUCCEEDED — first 3 lines:');
        console.log(text.split('\n').slice(0, 3).join('\n'));
      } else {
        console.log('download failed as documented (see sunat-sire-client.ts descargarArchivoReporte doc comment) — falling back to resumen CSV as the row source, per spec §1.');
      }
    }
  } catch (e) {
    console.log(`export/download flow error (non-fatal — resumen CSV fallback already validated above): ${e instanceof Error ? e.message : e}`);
  }

  console.log('\n=== DoD complete ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
