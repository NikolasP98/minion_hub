/**
 * Manifest of the hub's SYSTEM automations — the cron-driven endpoints that run
 * on a schedule with no agent and no chat behind them.
 *
 * ⚠️ Scheduling lives OUTSIDE this repo. The hub cannot read netcup's crontab,
 * so `wiring` is a hand-verified field, not live state. Re-verify with:
 *
 *     ssh niko@152.53.91.108 'crontab -l'        # + vercel.json "crons"
 *
 * Keep it honest: an entry claiming `netcup` that isn't in that output is worse
 * than no manifest at all. This surface exists precisely BECAUSE that drift is
 * invisible otherwise — `/api/crm/dni-validation/tick` was built, allowlisted in
 * hooks.server.ts, and then never scheduled, so it silently never ran. The
 * 2026-09-13 audit found the reverse drift too: nine ticks listed here as
 * `netcup` had been dropped from the crontab on 2026-07-25 and never restored.
 *
 * netcup ticks run through `~/.config/minion/health-gated-tick` (a Supabase
 * Auth health probe, then the endpoint) against the loopback Node worker; the
 * attachments case targets Vercel because that worker build predates the route.
 *
 * Adding a tick? It needs THREE things or it does nothing: the route, an entry
 * in the hooks.server.ts unauthenticated-API allowlist, and a crontab line.
 */
export type AutomationWiring = 'netcup' | 'vercel' | 'paused' | 'unscheduled';
/** Keys of the `automation_cadence_*` messages. */
export type Cadence =
  'minute' | 'ten_minutes' | 'quarter_hourly' | 'hourly' | 'daily' | 'daily_3am' | 'semimonthly';

export interface SystemAutomation {
  /** Endpoint path (with its scheduled query string) — also the stable id. */
  path: string;
  /** Message key suffix in `messages/*.json`: `automation_<key>_{title,desc}`. */
  key: string;
  /** Human cadence as scheduled (or as intended, when unscheduled). */
  cadence: Cadence;
  wiring: AutomationWiring;
}

/** Verified against `crontab -l` on 152.53.91.108 + vercel.json on 2026-09-13. */
export const SYSTEM_AUTOMATIONS: SystemAutomation[] = [
  // ── Scheduled on netcup — cadence verified against `crontab -l` ──────────
  { path: '/api/meta/sync/tick', key: 'meta_sync', cadence: 'ten_minutes', wiring: 'netcup' },
  // SUSII is decommissioned; this is a no-op safety net, so hourly is plenty.
  { path: '/api/finances/sync/tick', key: 'finance_sync', cadence: 'hourly', wiring: 'netcup' },
  {
    path: '/api/attachments/sweep/tick?mode=deletion-claims',
    key: 'attachment_sweep_claims',
    cadence: 'hourly',
    wiring: 'netcup',
  },
  // Default mode, daily 03:37: never-linked uploads older than 24 h plus files
  // whose every link has sat in the trash for 30+ days (the recycle-bin purge).
  // Scheduled 2026-09-13 after a read-only preflight found 0 reapable files.
  {
    path: '/api/attachments/sweep/tick',
    key: 'attachment_sweep',
    cadence: 'daily',
    wiring: 'netcup',
  },

  // ── Paused on purpose — line kept in the crontab, commented out ──────────
  // Paused 2026-09-12 for the fenced Node worker adoption
  // (scripts/ops/hub-worker-release.md). Resume = un-comment that one line.
  { path: '/api/jobs/tick', key: 'jobs', cadence: 'ten_minutes', wiring: 'paused' },

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
    cadence: 'daily',
    wiring: 'vercel',
  },
  {
    path: '/api/crm/insights/word-frequency/refresh',
    key: 'word_frequency',
    cadence: 'quarter_hourly',
    wiring: 'vercel',
  },
  {
    path: '/api/crm/insights/word-frequency/refresh/full',
    key: 'word_frequency_full',
    cadence: 'daily',
    wiring: 'vercel',
  },

  // ── Built + allowlisted, NOT in `crontab -l` ─────────────────────────────
  // Dropped from the crontab on 2026-07-25 (Supabase pool-drain recovery lane)
  // and never restored. Their modules have no production usage yet; restore each
  // as a `health-gated-tick` case when it does, then flip it to `netcup`.
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
  {
    path: '/api/reliability/retention/tick',
    key: 'retention',
    cadence: 'semimonthly',
    wiring: 'unscheduled',
  },
  { path: '/api/memberships/tick', key: 'memberships', cadence: 'hourly', wiring: 'unscheduled' },
  { path: '/api/crm/dni-validation/tick', key: 'dni', cadence: 'hourly', wiring: 'unscheduled' },
  {
    path: '/api/email-ledger/tick',
    key: 'email_ledger',
    cadence: 'daily_3am',
    wiring: 'unscheduled',
  },
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
  // The relationship-inference kernel: route + allowlist entry exist, no
  // crontab line ever did. ⚠️ It throws on the local worker until the
  // BRAIN_VECTOR_* keys are set there.
  {
    path: '/api/crm/relationship/tick',
    key: 'crm_relationship',
    cadence: 'hourly',
    wiring: 'unscheduled',
  },
];

/** Live first, then paused, then unscheduled — the gaps are what need attention. */
export function sortedSystemAutomations(): SystemAutomation[] {
  const rank: Record<AutomationWiring, number> = {
    netcup: 0,
    vercel: 1,
    paused: 2,
    unscheduled: 3,
  };
  return [...SYSTEM_AUTOMATIONS].sort(
    (a, b) => rank[a.wiring] - rank[b.wiring] || a.path.localeCompare(b.path),
  );
}

/** Anything that is not actually running on a schedule. */
export const unscheduledCount = () =>
  SYSTEM_AUTOMATIONS.filter((a) => a.wiring === 'unscheduled' || a.wiring === 'paused').length;
