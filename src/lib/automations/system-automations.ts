/**
 * Manifest of the hub's SYSTEM automations — the cron-driven endpoints that run
 * on a schedule with no agent and no chat behind them.
 *
 * ⚠️ Scheduling lives OUTSIDE this repo. The hub cannot read netcup's crontab,
 * so `wiring` is a hand-verified field, not live state. Re-verify with:
 *
 *     ssh niko@152.53.91.108 'crontab -l'
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

export interface SystemAutomation {
  /** Endpoint path — also the stable id. */
  path: string;
  /** Message key suffix in `messages/*.json`: `automation_<key>_{title,desc}`. */
  key: string;
  /** Human cadence as scheduled (or as intended, when unscheduled). */
  cadence: string;
  wiring: AutomationWiring;
}

/** Verified against `crontab -l` on 152.53.91.108 + vercel.json on 2026-07-19. */
export const SYSTEM_AUTOMATIONS: SystemAutomation[] = [
  // ── Scheduled on netcup (per-minute unless noted) ────────────────────────
  { path: '/api/scheduling/reminders/tick', key: 'reminders', cadence: 'minute', wiring: 'netcup' },
  { path: '/api/finances/sync/tick', key: 'finance_sync', cadence: 'minute', wiring: 'netcup' },
  { path: '/api/notifications/tick', key: 'notifications', cadence: 'minute', wiring: 'netcup' },
  { path: '/api/jobs/tick', key: 'jobs', cadence: 'minute', wiring: 'netcup' },
  { path: '/api/org-config/tick', key: 'org_config', cadence: 'minute', wiring: 'netcup' },
  { path: '/api/reliability/retention/tick', key: 'retention', cadence: 'minute', wiring: 'netcup' },
  { path: '/api/memberships/tick', key: 'memberships', cadence: 'hourly', wiring: 'netcup' },

  // ── Scheduled by Vercel (vercel.json crons) ──────────────────────────────
  { path: '/api/finances/sync/daily', key: 'finance_daily', cadence: 'daily_3am', wiring: 'vercel' },

  // ── Built + allowlisted but NOT scheduled anywhere ───────────────────────
  { path: '/api/crm/dni-validation/tick', key: 'dni', cadence: 'hourly', wiring: 'unscheduled' },
  { path: '/api/meta/sync/tick', key: 'meta_sync', cadence: 'hourly', wiring: 'unscheduled' },
  { path: '/api/email-ledger/tick', key: 'email_ledger', cadence: 'minute', wiring: 'unscheduled' },
  { path: '/api/crm/conversations/vectorize/tick', key: 'vectorize', cadence: 'hourly', wiring: 'unscheduled' },
  { path: '/api/crm/conversations/analyze/tick', key: 'analyze', cadence: 'hourly', wiring: 'unscheduled' },
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
