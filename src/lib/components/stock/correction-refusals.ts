import * as m from '$lib/paraglide/messages';

/** Every refusal the correction API can return, each with the next step for the user (closed list, spec 124). */
const BY_CODE: Record<string, () => string> = {
  forbidden: m.stock_corr_err_forbidden,
  cost_visibility_required: m.stock_corr_err_cost_visibility_required,
  owner_required: m.stock_corr_err_owner_required,
  not_found: m.stock_corr_err_not_found,
  stale_preview: m.stock_corr_err_stale_preview,
  operation_conflict: m.stock_corr_err_operation_conflict,
  key_reuse: m.stock_corr_err_key_reuse,
  price_differs: m.stock_corr_err_price_differs,
  stock_drift: m.stock_corr_err_stock_drift,
  negative_stock: m.stock_corr_err_negative_stock,
  source_ambiguous: m.stock_corr_err_source_ambiguous,
  dependent_history: m.stock_corr_err_dependent_history,
  policy_unverified: m.stock_corr_err_policy_unverified,
  period_locked: m.stock_corr_err_period_locked,
  record_locked: m.stock_corr_err_record_locked,
  invalid_policy: m.stock_corr_err_invalid_policy,
  stock_scope_required: m.stock_corr_err_stock_scope_required,
  owner_evidence_required: m.stock_corr_err_owner_evidence_required,
  duplicate_source: m.stock_corr_err_duplicate_source,
  module_disabled: m.stock_corr_err_module_disabled,
  repost_pending: m.stock_corr_err_repost_pending,
  unavailable: m.stock_corr_err_unavailable,
  invalid_request: m.stock_corr_err_invalid_request,
  refresh_required: m.stock_corr_err_refresh_required,
};

export const KNOWN_REFUSAL_CODES = Object.keys(BY_CODE);

/** Translated refusal with its next step; an unknown code gets the generic "check the result" message. */
export const correctionRefusal = (code: string | undefined): string =>
  (BY_CODE[code ?? ''] ?? m.stock_corr_err_generic)();
