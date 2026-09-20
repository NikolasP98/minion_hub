#!/usr/bin/env bun
/**
 * FACES payment methods (owner ask 2026-09-20): the register offers cash plus
 * the six accounts the clinic actually collects on; the "-SEBAS" accounts
 * (money received by a third party) and cash are never declared, so they carry
 * `sunat: false` and `submitTicket` issues no receipt for tickets paid with them.
 *
 * Existing ids are KEPT — `pos_payments.method` persists them on every past
 * ticket — so `plin` becomes "PLIN-FACES" and `transfer` "Transferencia-FACES".
 * Any other method (card, yape) is switched OFF, not deleted: history keeps its
 * label, the register stops offering it.
 *
 * Dry-run by default (prints current → next). `--apply` writes.
 *
 *   bun --env-file=.env scripts/faces-payment-methods.ts [--apply] [orgId]
 */
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const apply = process.argv.includes('--apply');
const orgId = process.argv.slice(2).find((x) => !x.startsWith('--')) ?? FACES_ORG;
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const sql = postgres(url, { prepare: false, max: 2 });

type Method = {
  id: string;
  label: string;
  enabled: boolean;
  takesTendered: boolean;
  sunat?: boolean;
  documentDefault?: '03' | '01' | null;
  surcharge?: { type: 'percent' | 'fixed'; amount: number };
};

/** Register order. `id` is stable; `label` is what the cashier sees. */
const WANTED: Array<Pick<Method, 'id' | 'label' | 'takesTendered' | 'sunat'>> = [
  { id: 'cash', label: 'Efectivo', takesTendered: true, sunat: false },
  { id: 'mercado-pago', label: 'Mercado Pago', takesTendered: false, sunat: true },
  { id: 'plin', label: 'PLIN-FACES', takesTendered: false, sunat: true },
  { id: 'plin-sebas', label: 'PLIN-SEBAS', takesTendered: false, sunat: false },
  { id: 'power-pay', label: 'Power Pay', takesTendered: false, sunat: true },
  { id: 'transfer', label: 'Transferencia-FACES', takesTendered: false, sunat: true },
  { id: 'transfer-sebas', label: 'Transferencia-SEBAS', takesTendered: false, sunat: false },
];

/** Same tolerance as pos.service `normalizeMethods`: legacy string[] rows. */
function normalize(raw: unknown): Method[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) =>
    typeof m === 'string'
      ? {
          id: m,
          label: m[0].toUpperCase() + m.slice(1),
          enabled: true,
          takesTendered: m === 'cash',
        }
      : (m as Method),
  );
}

const fmt = (m: Method) =>
  `${m.id.padEnd(16)} ${m.label.padEnd(22)} ${m.enabled ? 'on ' : 'off'} sunat=${m.sunat !== false}`;

async function main() {
  const [row] = await sql<{ methods: unknown }[]>`
    select methods from pos_settings where org_id = ${orgId}`;
  if (!row) throw new Error(`no pos_settings row for org ${orgId}`);
  const current = normalize(row.methods);
  const byId = new Map(current.map((m) => [m.id, m]));
  const next: Method[] = WANTED.map((w) => ({
    ...(byId.get(w.id) ?? {}),
    id: w.id,
    label: w.label,
    enabled: true,
    takesTendered: w.takesTendered,
    sunat: w.sunat,
    documentDefault: byId.get(w.id)?.documentDefault ?? null,
  }));
  // `credit` is the register's stored-value tender (client account balance),
  // not a bank account — never retired by this list.
  const retired = current
    .filter((m) => !WANTED.some((w) => w.id === m.id))
    .map((m) => (m.id === 'credit' ? m : { ...m, enabled: false }));
  const all = [...next, ...retired];
  if (new Set(all.map((m) => m.id)).size !== all.length) throw new Error('duplicate method id');

  console.log(`org ${orgId}\n\nCURRENT`);
  for (const m of current) console.log('  ' + fmt(m));
  console.log('\nNEXT');
  for (const m of all) console.log('  ' + fmt(m));
  if (retired.length)
    console.log(`
(kept, not in the list: ${retired.map((m) => m.id + (m.enabled ? '' : ' (off)')).join(', ')})`);
  if (!apply) {
    console.log('\nDRY RUN — re-run with --apply to write.');
    return;
  }
  await sql`update pos_settings set methods = ${sql.json(all as never)}, updated_at = now()
    where org_id = ${orgId}`;
  console.log(`\nAPPLIED — ${all.length} methods stored.`);
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
