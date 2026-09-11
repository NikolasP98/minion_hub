// Credential-free label stub for the isolated chart-accessibility fixture —
// same pattern as tests/fixtures/overlay-native/messages.js: only the keys the
// mounted components actually call, real English text (no locale machinery).
export const a11y0_chartRegion = () => 'Chart';
export const a11y0_chartTableCategory = () => 'Category';
/** @param {{ index: number }} params */
export const a11y0_chartSeriesN = (params) => `Series ${params.index}`;
export const a11y0_chartDataTable = () => 'View chart data as table';
/** @param {{ count: number }} params */
export const crm_insights_sentiment_n = (params) => `based on ${params.count} scored messages`;
export const crm_insights_sentiment_none = () => 'No sentiment scored yet';
export const crm_insights_sentiment_title = () => 'Customer sentiment';
export const crm_insights_sentiment_trend = () => 'Monthly customer-sentiment trend';
export const misc_date = () => 'Date';
