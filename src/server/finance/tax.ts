import {
  DEFAULT_IGV_RATE,
  IGV_RATE_NOT_VIGENTE_MESSAGE,
  isVigenteIgvRate,
} from '$lib/finance/igv-rates';
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

export { DEFAULT_IGV_RATE };

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
 *     `PUT /api/finances/settings` and `updateFinSettings` both validate with
 *     `isVigenteIgvRate` from `$lib/finance/igv-rates`
 * => the stored unit is ALREADY a fraction. There is no conversion to do, and
 * a percent-shaped value (18) cannot be written through any supported path, so
 * it is rejected below rather than "helpfully" divided by 100 — a
 * guess-by-magnitude heuristic would turn a data-entry typo into a
 * document that SUNAT happily accepts and that is wrong by two orders of
 * magnitude.
 *
 * ZERO throws (spec ⚠️ A2): SUNAT models exonerado/inafecto with different tax
 * category and scheme codes, not as a gravada line at `Percent 0`. Emitting a
 * 0% gravada document would be malformed, so refuse loudly instead.
 *
 * NON-VIGENTE RATES throw too, and that is the second gate rather than a
 * duplicate of the settings gate: the write boundary stops new bad values, but
 * a row persisted before that gate existed (or edited straight in the DB)
 * would otherwise still reach `sendBill` and be rejected there with fault 3462
 * — see `$lib/finance/igv-rates` for the live-beta evidence. Failing here
 * turns that into a refused emission with a readable reason, recorded as a
 * `status=error` row by `pos-emission.service`, instead of a SUNAT rejection.
 */
export function resolveIgvRate(settings: IgvRateSettings | null | undefined): number {
  const configured = settings?.taxRate;
  if (configured == null) return DEFAULT_IGV_RATE;
  const rate = Number(configured);
  if (!isVigenteIgvRate(rate)) {
    throw new PosError(
      `configured ${IGV_RATE_NOT_VIGENTE_MESSAGE}`,
      'invalid_tax_rate',
    );
  }
  return rate;
}
