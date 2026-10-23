/** Mandatory installed journeys. Selecting a subset can never qualify this matrix. */
export const ASSISTANT_INVALIDATIONS = [
  'owner_aba',
  'session_aba',
  'navigation_aba',
  'registry',
  'forged_notification',
  'reordered_reload',
  'stop',
  'source_teardown',
  'failed_refresh',
  'expired_capability',
] as const;
export type AssistantInvalidation = (typeof ASSISTANT_INVALIDATIONS)[number];
export const CRITICAL_CASE_PREFIXES = [
  'CJ1 ',
  'CJ2 ',
  'CJ3 ',
  'CJ4 ',
  'CJ5 ',
  'CJ6 ',
  'CJA1 ',
  'CJA2 ',
  ...ASSISTANT_INVALIDATIONS.map((_, index) => `CJA${index + 3} `),
  'CJA13 ',
  'CJA14 ',
  'CJA15 ',
] as const;
export const ASSISTANT_CONTEXT_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(
  CRITICAL_CASE_PREFIXES.filter((prefix) => prefix.startsWith('CJA')).map((prefix) => [
    prefix,
    prefix === 'CJA13 ' || prefix === 'CJA15 ' ? 12 : prefix === 'CJA14 ' ? 8 : 4,
  ]),
);
