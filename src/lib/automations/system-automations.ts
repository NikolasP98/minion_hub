/**
 * Manifest of the hub's SYSTEM automations — the cron-driven endpoints that run
 * on a schedule with no agent and no chat behind them.
 *
 * ⚠️ Scheduling lives OUTSIDE this repo. The hub cannot read netcup's crontab,
 * so `wiring` is a hand-verified field, not live state. Re-verify with:
 *
 *     ssh netcup 'crontab -l'      # niko@152.53.91.108
 *
 * Keep it honest: an entry claiming `netcup` that isn't in that output is worse
 * than no manifest at all. This surface exists precisely BECAUSE that drift is
 * invisible otherwise — `/api/crm/dni-validation/tick` was built, allowlisted in
 * hooks.server.ts, and then never scheduled, so it silently never ran.
 *
 * Adding a tick? It needs THREE things or it does nothing: the route, an entry
 * in the hooks.server.ts unauthenticated-API allowlist, and a crontab line.
 */
export type AutomationWiring = 'netcup' | 'vercel' | 'unscheduled';
/** Keys of the `automation_cadence_*` messages. */
export type Cadence = 'minute' | 'ten_minute' | 'hourly' | 'daily_3am' | 'semimonthly';

export interface SystemAutomation {
  /** Endpoint path — also the stable id. */
  path: string;
  /** Message key suffix in `messages/*.json`: `automation_<key>_{title,desc}`. */
  key: string;
  /** Human cadence as scheduled (or as intended, when unscheduled). */
  cadence: Cadence;
  wiring: AutomationWiring;
}

/**
 * Verified against `ssh netcup 'crontab -l'` + vercel.json on **2026-08-13**.
 *
 * ⚠️ The 2026-07-25 pass claimed 12 netcup entries. The crontab has FOUR lines,
 * two of which are hub ticks — everything else below is `unscheduled` and had
 * been silently doing nothing. The drift was found only because a frozen
 * finance sync sat unresumed for a day; nothing else surfaced it.
 *
 * The box runs a deliberately narrow "production recovery lane" (its own
 * comment): meta + jobs on a 10-minute cadence, offset 5 minutes apart, both taking the SAME
 * `hub-cron-global.lock` with `flock -n` so they are serialized globally and a
 * slow run is skipped rather than stacked. Anything added here must respect
 * that lock and pick a free offset — a tick that hogs it starves the others,
 * and `brain-vector-health-controller` pins the vector worker to 0/0 if the
 * meta/jobs tick log goes stale past 900s.
 */
export const SYSTEM_AUTOMATIONS: SystemAutomation[] = [
  // ── ACTUALLY scheduled on netcup (the only two; 10-min cadence, global lock) ──
  { path: '/api/meta/sync/tick', key: 'meta_sync', cadence: 'ten_minute', wiring: 'netcup' },
  { path: '/api/jobs/tick', key: 'jobs', cadence: 'ten_minute', wiring: 'netcup' },

  // ── Scheduled by Vercel (vercel.json crons) ──────────────────────────────
  {
    path: '/api/finances/sync/daily',
    key: 'finance_daily',
    cadence: 'daily_3am',
    wiring: 'vercel',
  },
  {
    path: '/api/brains/reconcile/tick',
    key: 'brains_reconcile',
    cadence: 'daily_3am',
    wiring: 'vercel',
  },

  // ── NOT in the crontab. Previously claimed 'netcup' — they never ran. ────
  // finance_sync is the one that bit us: without it a Vercel-frozen sync job
  // has no resumer, so it only advances when the daily cron happens to
  // re-claim it (once/day, 50s at a time).
  {
    path: '/api/finances/sync/tick',
    key: 'finance_sync',
    cadence: 'minute',
    wiring: 'unscheduled',
  },
  {
    path: '/api/scheduling/reminders/tick',
    key: 'reminders',
    cadence: 'minute',
    wiring: 'unscheduled',
  },
  {
    path: '/api/notifications/tick',
    key: 'notifications',
    cadence: 'minute',
    wiring: 'unscheduled',
  },
  { path: '/api/org-config/tick', key: 'org_config', cadence: 'hourly', wiring: 'unscheduled' },
  { path: '/api/memberships/tick', key: 'memberships', cadence: 'hourly', wiring: 'unscheduled' },
  { path: '/api/crm/dni-validation/tick', key: 'dni', cadence: 'hourly', wiring: 'unscheduled' },
  {
    path: '/api/crm/conversations/vectorize/tick',
    key: 'vectorize',
    cadence: 'hourly',
    wiring: 'unscheduled',
  },
  {
    path: '/api/crm/conversations/analyze/tick',
    key: 'analyze',
    cadence: 'hourly',
    wiring: 'unscheduled',
  },
  {
    path: '/api/email-ledger/tick',
    key: 'email_ledger',
    cadence: 'daily_3am',
    wiring: 'unscheduled',
  },
  {
    path: '/api/reliability/retention/tick',
    key: 'retention',
    cadence: 'semimonthly',
    wiring: 'unscheduled',
  },

  // ── Built + allowlisted, NOT yet in `crontab -l` ─────────────────────────
  // The relationship-inference kernel. Route + hooks.server.ts allowlist exist,
  // but no crontab line — runs only when invoked by hand.
  {
    path: '/api/crm/relationship/tick',
    key: 'crm_relationship',
    cadence: 'hourly',
    wiring: 'unscheduled',
  },
];

/** Scheduled first, unscheduled last — the gaps are what need attention. */
export function sortedSystemAutomations(): SystemAutomation[] {
  const rank: Record<AutomationWiring, number> = { netcup: 0, vercel: 1, unscheduled: 2 };
  return [...SYSTEM_AUTOMATIONS].sort(
    (a, b) => rank[a.wiring] - rank[b.wiring] || a.path.localeCompare(b.path),
  );
}

export const unscheduledCount = () =>
  SYSTEM_AUTOMATIONS.filter((a) => a.wiring === 'unscheduled').length;
