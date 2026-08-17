/**
 * `--rate <fraction>` for the manual live-beta emission harnesses. Shared by
 * emit-beta-test.ts / shadow-emit-test.ts / summary-beta-test.ts so a live run
 * can exercise a non-statutory document (spec
 * 2026-08-17-hub-igv-rate-from-org-config-spec §S3 step "Live beta
 * re-verification": ResponseCode 0 at 18% AND at 10%) without editing code.
 *
 * These harnesses build synthetic payloads with no org behind them, so the rate
 * is stated on the command line instead of resolved from `fin_settings` — the
 * production path goes through `resolveIgvRate()` (src/server/finance/tax.ts),
 * which is deliberately NOT imported here: it pulls in `$env`/db-bound modules
 * that plain `bun run` (no SvelteKit runtime) cannot resolve.
 */

/** Peru statutory IGV rate — the harness default, mirroring `DEFAULT_IGV_RATE`. */
const STATUTORY_RATE = 0.18;

export function parseRateArg(argv: string[] = process.argv): number {
  const i = argv.indexOf('--rate');
  if (i < 0) return STATUTORY_RATE;
  const raw = argv[i + 1];
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
    console.error(`--rate must be a fraction between 0 and 1, exclusive (got ${String(raw)})`);
    process.exit(1);
  }
  return rate;
}
