import * as m from '$lib/paraglide/messages';
import type { Range } from '$lib/sandbox/blocks/schema';

/** Labels for the block date presets, resolved at render time (never at module load: locale). */
export const RANGE_LABEL: Record<Range, () => string> = {
  today: () => m.sandbox_filter_range_today(),
  yesterday: () => m.sandbox_filter_range_yesterday(),
  last_7d: () => m.sandbox_filter_range_last_7d(),
  last_30d: () => m.sandbox_filter_range_last_30d(),
  last_90d: () => m.sandbox_filter_range_last_90d(),
  this_week: () => m.sandbox_filter_range_this_week(),
  this_month: () => m.sandbox_filter_range_this_month(),
  last_month: () => m.sandbox_filter_range_last_month(),
  this_year: () => m.sandbox_filter_range_this_year(),
  all: () => m.sandbox_filter_range_all(),
};
