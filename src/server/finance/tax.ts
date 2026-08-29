import { PosError } from '$server/services/pos.service';

/**
 * The ONE boundary where the org's configured tax rate becomes the emission
 * library's `EmissionInvoice.igvRate`. S2 of
 * specs/2026-08-17-hub-igv-rate-from-org-config-spec.md.
 *
 * It lives here, outside `finance/emission/`, on purpose: the emission library
 * must contain no rate constant at all, so there is exactly one default and
 * exactly one validation in the codebase and `rg 'IGV_RATE|0\.18'
 * src/server/finance/emission/` stays empty.
 */

/**
 * Peru's statutory IGV rate — and the pre-existing behaviour for orgs that
 * never configured one (`fin_settings` has no row, so `getFinSettings` hands
 * back `DEFAULT_FIN_SETTINGS`). Keeping it here, and only here, is what makes
 * this slice bit-identical for every org emitting today.
 */
export const DEFAULT_IGV_RATE = 0.18;

/** Just the slice of `FinSettings` this needs — so callers can pass the whole
 *  settings object without this module depending on finance.service.ts. */
export interface IgvRateSettings {
  taxRate?: number | null;
}

/**
 * Normalize + validate `fin_settings.tax_rate` into an IGV rate usable by the
 * emission library.
 *
 * UNIT (spec ⚠️ A1, settled from the schema and every writer — this checkout
 * has no DB access, so the evidence is the code path, not a live query):
 *   - `supabase/migrations/20260708180000_fin_settings.sql`:
 *     `tax_rate numeric not null default 0.18   -- IGV as a fraction`
 *   - `src/server/db/pg-finance-schema.ts` mirrors that default and comment
 *   - writers: `/finances/settings/+page.svelte` posts `Number(taxPct) / 100`;
 *     `PUT /api/finances/settings` validates `z.number().min(0).max(0.9999)`;
 *     `updateFinSettings` re-checks "a fraction in [0, 1)"
 * => the stored unit is ALREADY a fraction. There is no conversion to do, and
 * a percent-shaped value (18) cannot be written through any supported path, so
 * it is rejected below rather than "helpfully" divided by 100 — a
 * guess-by-magnitude heuristic would turn a data-entry typo into a document
 * that SUNAT happily accepts and that is wrong by two orders of magnitude.
 *
 * ZERO throws (spec ⚠️ A2): SUNAT models exonerado/inafecto with different tax
 * category and scheme codes, not as a gravada line at `Percent 0`. Emitting a
 * 0% gravada document would be malformed, so refuse loudly instead.
 *
 * TODO(handoff): an org that legitimately operates exonerada/inafecta (SUNAT
 * catalog 07 codes 20/30, tax schemes 9997/9998) therefore has NO path to
 * emission at all — it gets `invalid_tax_rate` on every ticket, which is honest
 * but is not a feature. Those document shapes are explicitly out of scope of
 * specs/2026-08-17-hub-igv-rate-from-org-config-spec.md §5 (one rate per
 * document, gravada only) and need their own spec: per-line affectation type,
 * the `LegalMonetaryTotal` exempt/unaffected buckets, and a settings surface to
 * declare the operation type. Nothing here should be relaxed to fake it.
 */
export function resolveIgvRate(settings: IgvRateSettings | null | undefined): number {
  const configured = settings?.taxRate;
  if (configured == null) return DEFAULT_IGV_RATE;
  const rate = Number(configured);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
    throw new PosError('configured tax rate is not usable for SUNAT emission', 'invalid_tax_rate');
  }
  return rate;
}
