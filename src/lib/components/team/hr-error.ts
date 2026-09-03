import { ApiError } from '$lib/api/fetch-json';
import { mutationErrorMessage } from '$lib/api/json-mutation';
import * as m from '$lib/paraglide/messages';

/** HR rule violations arrive as 409 `{ error: code }` — localise the code, fall back to the message. */
const CODES: Record<string, () => string> = {
  employee_inactive: m.team_err_employee_inactive,
  invalid_range: m.team_err_invalid_range,
  only_holidays: m.team_err_only_holidays,
  overlap: m.team_err_overlap,
  max_days: m.team_err_max_days,
  no_balance: m.team_err_no_balance,
  self_approval: m.team_err_self_approval,
  bad_transition: m.team_err_bad_transition,
  left_needs_date: m.team_err_left_needs_date,
  not_found: m.team_err_not_found,
};

export function hrErrorMessage(error: unknown): string {
  const code =
    error instanceof ApiError && error.details && typeof error.details === 'object'
      ? (error.details as { error?: unknown }).error
      : undefined;
  const localised = typeof code === 'string' ? CODES[code] : undefined;
  return localised ? localised() : mutationErrorMessage(error, m.common_error());
}
