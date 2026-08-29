/**
 * The IGV rates this product may put on a SUNAT document — the single source
 * of truth shared by the settings write boundary (`updateFinSettings`, the
 * `PUT /api/finances/settings` schema, and the `/finances/settings` form, which
 * offers these rates as a Select rather than a free percent field) and the
 * emission boundary (`resolveIgvRate`, `$server/finance/tax`).
 *
 * WHY AN ALLOWLIST, and not "any fraction in (0, 1)": a live run against
 * SUNAT's beta validator on 2026-08-29 had `sendBill` hard-reject both a boleta
 * and a factura carrying a 10% IGV with fault `soap-env:Client.3462` — "La tasa
 * del IGV debe ser la misma en todas las líneas o ítems del documento y debe
 * corresponder con una tasa vigente" — while the same documents at 18% came
 * back `ResponseCode 0`. The rate is not free-form: SUNAT only accepts one that
 * is in force for the emitter's regime. Accepting an arbitrary percentage at
 * the settings boundary therefore let an admin save a value that made every
 * subsequent emission for that org fail, with nothing in the product saying so.
 * Full matrix, including why a green `submitResumen` proves nothing:
 * `specs/2026-08-17-hub-igv-rate-from-org-config-s3-actuals.md`.
 *
 * It lives in `$lib` rather than next to `resolveIgvRate` on purpose: the
 * settings form needs it too, and `$server/finance/tax.ts` imports `PosError`
 * from `pos.service`, which already imports `finance.service` — routing the
 * settings writers through `tax.ts` would close an import cycle.
 */

/**
 * Peru's statutory IGV rate (16% IGV + 2% IPM), and the rate every org emitted
 * at before `fin_settings.tax_rate` was threaded into emission — so an org that
 * never configured a rate stays bit-identical to before that change.
 */
export const DEFAULT_IGV_RATE = 0.18;

/**
 * Every rate a document may declare. Each entry must have been accepted by
 * SUNAT's `sendBill` (CDR `ResponseCode 0`) — 0.18 was, on 2026-08-29 beta,
 * via `bun scripts/emit-beta-test.ts`. That script is the admission test for
 * any candidate rate.
 *
 * SCOPE: the general regime only. Peru has had reduced-rate regimes for
 * specific taxpayers (the MYPE restaurant / hotel / tourist-accommodation
 * reduction), which are eligibility-gated and time-bounded.
 */
// TODO(handoff): supporting a reduced-rate regime is NOT "append a number
// here" — `fin_settings` holds one scalar with no regime/eligibility column,
// so a second entry would be wrong for every org that is not eligible, and the
// applicable reduced rate is time-bounded; it needs its own spec. Tracked as an
// open follow-up in minion-meta
// `proposals/2026-08-17-hub-igv-rate-from-org-config.md` ("Follow-ups this pass
// deliberately left open"), which now records the 2026-08-29 matrix and the
// fail-closed decision; its earlier "no beta certificate, make 10% pass" item
// was disproved by that run and has been replaced there. Runtime evidence:
// `specs/2026-08-17-hub-igv-rate-from-org-config-s3-actuals.md`.
export const SUNAT_VIGENTE_IGV_RATES: readonly number[] = [DEFAULT_IGV_RATE];

/** A fraction rendered as the percent the UI and SUNAT both talk in: `18%`. */
export function formatIgvRate(rate: number): string {
  return `${Math.round(rate * 10000) / 100}%`;
}

/** Human-readable list of what `isVigenteIgvRate` accepts, for error copy. */
export const SUNAT_VIGENTE_IGV_RATES_LABEL = SUNAT_VIGENTE_IGV_RATES.map(formatIgvRate).join(', ');

/** The one rejection message, so the API, the service and the emitter agree. */
export const IGV_RATE_NOT_VIGENTE_MESSAGE =
  `tax rate must be an IGV rate SUNAT currently accepts (${SUNAT_VIGENTE_IGV_RATES_LABEL}); ` +
  'any other rate is rejected at emission with fault 3462';

/**
 * True only for a rate SUNAT is known to accept.
 *
 * Compared with a tolerance rather than `===` because the value round-trips
 * through a Postgres `numeric` and through the form's percent↔fraction
 * conversion; the window is far tighter than the gap between any two candidate
 * rates, so it cannot let a genuinely different rate through.
 */
export function isVigenteIgvRate(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return SUNAT_VIGENTE_IGV_RATES.some((rate) => Math.abs(value - rate) < 1e-9);
}
