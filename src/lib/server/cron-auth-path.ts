const CRON_AUTH_PATHS = new Set([
  '/api/scheduling/reminders/tick',
  '/api/finances/sync/tick',
  '/api/finances/sync/daily',
  '/api/notifications/tick',
  '/api/memberships/tick',
  '/api/org-config/tick',
  '/api/jobs/tick',
  '/api/brains/reconcile/tick',
  '/api/meta/sync/tick',
  '/api/meta/attribution',
  '/api/email-ledger/tick',
  '/api/crm/dni-validation/tick',
  '/api/crm/conversations/vectorize/tick',
  '/api/crm/conversations/analyze/tick',
  '/api/crm/relationship/tick',
  '/api/crm/insights/word-frequency/refresh',
  '/api/crm/insights/word-frequency/refresh/full',
  '/api/reliability/retention/tick',
]);

/** Routes authenticated by their own CRON_SECRET bearer rather than a user session. */
export function isCronAuthPath(path: string): boolean {
  return CRON_AUTH_PATHS.has(path);
}
