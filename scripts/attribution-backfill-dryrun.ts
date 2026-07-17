#!/usr/bin/env bun
/**
 * DRY-RUN report for the Tier-2 IG-DM ad-attribution backfill (spec
 * 2026-07-17-ig-ad-attribution-spec.md §"Tier 2"). Writes NOTHING — prints a
 * markdown report (bucket counts, per-campaign lead totals, 20 samples).
 *
 *   bun scripts/attribution-backfill-dryrun.ts [orgId]
 *
 * Why a plugin shim: the backfill service uses the app's `withOrgCore` (RLS
 * enforced), whose module graph statically imports SvelteKit virtuals
 * ($env/dynamic/private, $app/environment) and the $server alias — neither
 * resolves under bare bun. We register a Bun plugin that shims those virtuals
 * to process.env and maps $server→src/server, THEN dynamically import the
 * service so the plugin applies. The ctx we hand it carries our own postgres-js
 * drizzle handle (a non-managed db → withOrgCore runs the txn on it directly,
 * never touching pg-pool), so the real apply path is exercised unchanged.
 */
// Side-effect import: registers the Bun plugin that shims SvelteKit virtuals so
// the dynamically-imported $server service graph resolves under bare bun.
import './_sveltekit-bun-shim.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
// jacqueline_merc — first contact 2026-05-04, "Slim Face" → Slimface | IG-DM.
const JACQUELINE = '25929621116711904';

const orgId = process.argv.slice(2).find((x) => !x.startsWith('--')) ?? FACES_ORG;
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set (check .env.local)');

const client = postgres(url, { prepare: false, max: 5 });

async function main() {
  const { runBackfill } = await import('../src/server/services/meta/attribution-backfill.service.ts');
  // Runnable classifier self-check (the pure parser is the risky logic).
  const { classifyOpener } = await import('../src/server/services/meta/attribution-heuristic.ts');
  for (const [op, origin, product] of [
    ['Hola, vi su anuncio de Afinamiento de Rostro 🫶', 'ad', 'slimface'],
    ['Hola, quiero info de Slimface 💫', 'ad', 'slimface'],
    ['¿Cuánto cuestan las sesiones?', 'organic', null],
    ['', 'unknown', null],
  ] as const) {
    const c = classifyOpener(op);
    if (c.origin !== origin || c.product !== product) {
      throw new Error(`classifyOpener(${JSON.stringify(op)}) => ${JSON.stringify(c)}`);
    }
  }

  const db = drizzle(client);
  const ctx = { db, tenantId: orgId } as unknown as import('../src/server/auth/core-ctx').CoreCtx;

  const r = await runBackfill(ctx, { dryRun: true, spotlightSenderIds: [JACQUELINE] });

  const bucketOrder = ['ad-high', 'ad-medium', 'ad-low', 'organic', 'unknown'];
  const bucketKeys = [...new Set([...bucketOrder, ...Object.keys(r.buckets)])].filter((k) => r.buckets[k]);
  const pct = (n: number) => (r.total ? ((n / r.total) * 100).toFixed(1) : '0.0');
  const adTotal = (r.buckets['ad-high'] ?? 0) + (r.buckets['ad-medium'] ?? 0) + (r.buckets['ad-low'] ?? 0);

  const out: string[] = [];
  out.push(`# IG-DM Ad-Attribution Backfill — DRY RUN`);
  out.push('');
  out.push(`Org \`${orgId}\` · ${r.total} first-inbound IG chats · **nothing written**.`);
  out.push('');
  out.push(`## Buckets`);
  out.push('');
  out.push(`| bucket | leads | % |`);
  out.push(`|---|--:|--:|`);
  for (const k of bucketKeys) out.push(`| ${k} | ${r.buckets[k]} | ${pct(r.buckets[k])}% |`);
  out.push(`| **ad-attributable (any)** | **${adTotal}** | **${pct(adTotal)}%** |`);
  out.push('');
  out.push(`## Per-campaign lead totals`);
  out.push('');
  out.push(`| campaign | leads |`);
  out.push(`|---|--:|`);
  for (const c of r.perCampaign) out.push(`| ${c.campaignName} | ${c.leads} |`);
  if (r.perCampaign.length === 0) out.push(`| _(none matched)_ | 0 |`);
  out.push('');
  out.push(`## Samples (spread across buckets)`);
  out.push('');
  out.push(`| origin/conf | product | campaign | opener |`);
  out.push(`|---|---|---|---|`);
  for (const s of r.samples) {
    const opener = (s.opener ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 60);
    out.push(`| ${s.origin}/${s.confidence} | ${s.product ?? '—'} | ${s.campaignName ?? '—'} | ${opener} |`);
  }
  out.push('');
  out.push(`## Spotlight — jacqueline_merc (\`${JACQUELINE}\`)`);
  out.push('');
  if (r.spotlight.length === 0) {
    out.push(`_not found in first-inbound set_`);
  } else {
    for (const s of r.spotlight) {
      out.push(
        `- opener: \`${(s.opener ?? '').replace(/\s+/g, ' ')}\` → **${s.origin}/${s.confidence}**, product \`${s.product}\`, campaign **${s.campaignName ?? '—'}**`,
      );
    }
  }
  out.push('');
  console.log(out.join('\n'));
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
