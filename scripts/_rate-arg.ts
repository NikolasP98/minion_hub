/**
 * `--rate <fraction>` for the live-beta smoke scripts (S2 of
 * 2026-08-17-hub-igv-rate-from-org-config-spec.md): they are synthetic-payload
 * harnesses with no org behind them, so they carry an explicit literal rate —
 * but it must be settable from the command line so a non-18% document can be
 * put in front of SUNAT's real validator without editing code.
 *
 * Deliberately does NOT import `resolveIgvRate`, for two reasons. Mechanically:
 * that module pulls in `pos.service.ts` (db + `$env`) and these scripts run
 * under plain `bun run`, with no SvelteKit runtime. Substantively: this check is
 * INTENTIONALLY looser than the product's — `resolveIgvRate`/`isVigenteIgvRate`
 * fail closed on anything but a SUNAT-vigente rate, whereas these harnesses
 * exist precisely to put a non-vigente rate in front of SUNAT's own validator
 * and record what it answers (see the run of record in emit-beta-test.ts).
 * A bare sanity range is all that belongs here.
 */
export function rateArg(argv: string[] = process.argv, fallback = 0.18): number {
  const i = argv.indexOf('--rate');
  if (i === -1) return fallback;
  const rate = Number(argv[i + 1]);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
    console.error(
      `--rate must be an IGV fraction in (0, 1), e.g. --rate 0.10 (got: ${argv[i + 1]})`,
    );
    process.exit(1);
  }
  return rate;
}
