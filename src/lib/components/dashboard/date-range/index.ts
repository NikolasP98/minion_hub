/**
 * Dashboard date-range SDK.
 *
 * The shared vocabulary behind `DateRangeControls.svelte`, usable on its own by
 * any surface that filters by a date window.
 *
 *   periods — granularity + the SMART enable/coerce rules
 *   ranges  — the quick-range registry (id + shorthand label + resolver)
 *   url     — search-param and inclusive ms-timestamp adapters
 *   storage — per-user pill visibility + default range
 *
 * Governance: every date window is INCLUSIVE of the whole `to` day. Use
 * `toTimestamps()` for JS-side filters; SQL uses the half-open
 * `col >= from AND col < (to + interval '1 day')`.
 */
export {
  type Period,
  ALL_PERIODS,
  ALL_PERIODS_WITH_TIME,
  PERIOD_MIN_MINUTES,
  PERIOD_MAX_MINUTES,
  spanMinutes,
  daysBetween,
  periodEnabled,
  enabledPeriods,
  coercePeriod,
} from './periods';

export {
  type RangeId,
  type DateRange,
  type RangeContext,
  type RangeDef,
  RANGE_DEFS,
  ALL_RANGE_IDS,
  SUBDAY_RANGE_IDS,
  DATE_RANGE_IDS,
  DEFAULT_VISIBLE_RANGES,
  isSubDayRange,
  isoDate,
  isoDateTime,
  rangeDef,
  resolveRange,
  matchRange,
  orderRangeIds,
} from './ranges';

export {
  type RangeParamOptions,
  START_OF_DAY,
  END_OF_DAY,
  fromSearchParams,
  toSearchParams,
  toTimestamps,
  fromTimestamps,
} from './url';

export {
  type RangeConfig,
  defaultRangeConfig,
  loadRangeConfig,
  saveRangeConfig,
  toggleRangeVisible,
  setDefaultRange,
} from './storage';
