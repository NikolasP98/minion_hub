import { PosError } from '$server/services/pos.service';

/**
 * The org tax-rate boundary for SUNAT emission (spec
 * 2026-08-17-hub-igv-rate-from-org-config-spec §S2). ONE place normalizes,
 * validates and defaults the rate; everything downstream — `EmissionInvoice
 * .igvRate`, `computeTotals`, the declared `cbc:Percent` — just carries the
 * fraction it returns. Deliberately NOT under `emission/`: the library must
 * stay free of any rate constant.
 */

/**
 * Peru's statutory IGV rate, as a fraction — the single default in the
 * codebase. Used only when an org has no configured rate at all (no
 * `fin_settings` row, or a null `tax_rate`), which is also the behavior every
 * shadow-emitting org had before the rate became configurable. Keeping it here
 * is what makes those orgs byte-identical after this change instead of silently
 * re-priced.
 */
export const DEFAULT_IGV_RATE = 0.18;

/** The one field `resolveIgvRate` needs from `FinSettings` — kept structural so
 *  callers can pass the whole settings object or just the rate. */
export interface IgvRateSource {
  taxRate?: number | string | null;
}

/**
 * Resolve the IGV rate an org's SUNAT documents must declare, as a FRACTION.
 *
 * STORAGE UNIT (settled by recon, do not re-derive — 2026-08-17):
 * `fin_settings.tax_rate` is a FRACTION, never a percent. Evidence:
 *   - `supabase/migrations/20260708180000_fin_settings.sql`:
 *     `tax_rate numeric not null default 0.18, -- IGV as a fraction`
 *   - `src/server/db/pg-finance-schema.ts` mirrors that default and comment
 *   - the writer `PUT /api/finances/settings` validates
 *     `z.number().min(0).max(0.9999)`, and `updateFinSettings()` rejects
 *     anything outside `[0, 1)`
 *   - the settings UI stores `Number(taxPct) / 100`
 * So there is NO unit conversion here, and deliberately no "guess by magnitude"
 * heuristic (`> 1 ⇒ percent`): a stored `18` is a data-entry bug, and inferring
 * a unit from it would turn that typo into an internally-consistent SUNAT
 * document that nothing downstream can catch. It throws instead.
 *
 * Throws `PosError('invalid_tax_rate')` — including on `0`: an exonerated /
 * inafecta operation is a different UBL document (SUNAT's 9997/9998 tax
 * category family and different LegalMonetaryTotal buckets), not a 0% version
 * of a gravada one, so emitting `Percent 0` under the gravada scheme would be
 * malformed. Out of scope per the spec §5; refused loudly rather than emitted.
 * In shadow mode this surfaces as a logged failure and never blocks checkout
 * (`triggerShadowEmission` swallows it) — see the handoff note there.
 */
export function resolveIgvRate(settings: IgvRateSource | null | undefined): number {
  const stored = settings?.taxRate;
  if (stored == null || stored === '') return DEFAULT_IGV_RATE;
  const rate = Number(stored);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
    throw new PosError(
      `configured tax rate is not usable for SUNAT emission: ${String(stored)} (expected a fraction between 0 and 1, exclusive)`,
      'invalid_tax_rate',
    );
  }
  return rate;
}
