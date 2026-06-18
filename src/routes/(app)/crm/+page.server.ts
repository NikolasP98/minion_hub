import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listContactsCached } from '$server/services/crm-contacts.service';
import { crmRevenueSummary, contactFinanceMap } from '$server/services/crm-finance.service';
import { FUNNEL_ORDER, effectiveFunnelStage, maxFunnelStage, financeFloorStage } from '$lib/components/crm/crm-funnel';
import { temperatureOf } from '$lib/components/crm/crm-format';

const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'] as const;

// Date-range presets for the dashboard cohort filter (acquisition window).
const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the dashboard's acquisition-date window from query params. Presets
 * ('7d'|'30d'|'90d'|'365d') count back from now; 'custom' reads from/to
 * (YYYY-MM-DD, inclusive); anything else ('all' / unknown) means no window.
 */
function resolveRange(params: URLSearchParams, now: number): { range: string; fromTs: number; toTs: number } {
  const range = params.get('range') ?? 'all';
  if (range === 'custom') {
    const from = params.get('from');
    const to = params.get('to');
    const fromTs = from ? Date.parse(`${from}T00:00:00`) : -Infinity;
    const toTs = to ? Date.parse(`${to}T23:59:59`) : now;
    return { range, fromTs: Number.isFinite(fromTs) ? fromTs : -Infinity, toTs: Number.isFinite(toTs) ? toTs : now };
  }
  const days = RANGE_DAYS[range];
  if (days) return { range, fromTs: now - days * DAY_MS, toTs: now };
  return { range: 'all', fromTs: -Infinity, toTs: Infinity };
}

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:contacts');

  // Reuse the same Valkey-cached roster the Customers list loads, then aggregate
  // server-side into a COMPACT summary — the dashboard never ships the full
  // roster (that 941 KB payload is what makes the list page heavy), only counts.
  const roster = await listContactsCached(ctx);

  // Acquisition-date cohort filter: scope the contact-derived widgets to people
  // first seen within the selected window (default 'all' = today's behaviour).
  // Revenue stays an all-time rollup (it's invoice-keyed, a different axis).
  const nowMs = Date.now();
  const { range, fromTs, toTs } = resolveRange(url.searchParams, nowMs);
  const all =
    range === 'all'
      ? roster
      : roster.filter((c) => {
          const t = c.first_contact_at ? Date.parse(c.first_contact_at) : NaN;
          return Number.isFinite(t) && t >= fromTs && t <= toTs;
        });
  const total = all.length;

  // Lifecycle stage breakdown (drives the funnel).
  const stageCounts: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]));
  // RFM score distribution in 10 buckets (0–9, 10–19, … 90–100).
  const scoreBuckets = new Array(10).fill(0) as number[];
  // Channel mix across all contacts (a contact can span several channels).
  const channelMix: Record<string, number> = {};
  let scoreSum = 0;

  // "New this period" = first seen within the last 30 days.
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  let newCount = 0;
  let activeWeek = 0; // contacted within the last 7 days

  // Marketing-funnel breakdown (drives the dashboard ribbon). Counts the
  // effective stage per contact (stored _funnel else baseline lead).
  const funnelCounts: Record<string, number> = Object.fromEntries(FUNNEL_ORDER.map((s) => [s, 0]));

  // Engagement temperature split (hot/warm/cold) derived from the RFM score —
  // the dashboard's at-a-glance "who's worth chasing right now".
  const temperature = { hot: 0, warm: 0, cold: 0 };

  // Per-contact billing classification (empty unless CRM + Finances both on) so
  // the funnel counts reflect real purchases, not just chat sentiment.
  const financeMap = await contactFinanceMap(ctx);

  // B5 — message responsiveness: of contacts who wrote in, how many are still
  // awaiting our reply (last message inbound), split by temperature.
  let inboundContacts = 0;
  let awaiting = 0;
  const awaitingByTemp = { hot: 0, warm: 0, cold: 0 };
  // B6 — conversion funnel (acquisition cohort): leads → booked (any reservation
  // /invoice) → bought (a real procedure). Reservation = the "cita agendada".
  let booked = 0;
  let bought = 0;

  for (const c of all) {
    if (c.stage in stageCounts) stageCounts[c.stage]++;
    const b = Math.min(9, Math.max(0, Math.floor(c.score / 10)));
    scoreBuckets[b]++;
    scoreSum += c.score;
    temperature[temperatureOf(c.score)]++;
    for (const ch of c.channels ?? []) channelMix[ch] = (channelMix[ch] ?? 0) + 1;
    if (c.first_contact_at && now - Date.parse(c.first_contact_at) <= THIRTY_DAYS) newCount++;
    if (c.last_contact_at && now - Date.parse(c.last_contact_at) <= SEVEN_DAYS) activeWeek++;
    const fin = financeMap[c.contact_id] ?? null;
    const fs = maxFunnelStage(
      effectiveFunnelStage(c.custom_fields, { inbound: c.inbound_msgs }),
      financeFloorStage(fin),
    );
    if (fs) funnelCounts[fs]++;
    if (c.inbound_msgs > 0) {
      inboundContacts++;
      if (c.awaiting_reply) {
        awaiting++;
        awaitingByTemp[temperatureOf(c.score)]++;
      }
    }
    if (fin) booked++;
    if (fin?.purchased) bought++;
  }

  // B5 response stats. answered = inbound contacts we've replied to most recently.
  const answered = inboundContacts - awaiting;
  const response = {
    inboundContacts,
    awaiting,
    answered,
    awaitingByTemp,
    responseRate: inboundContacts ? Math.round((answered / inboundContacts) * 100) : 0,
  };
  // B6 conversion rates (guarded against the rare booked-without-inbound case).
  const leads = inboundContacts;
  const conversion = {
    leads,
    booked,
    bought,
    bookedRate: leads ? Math.round((Math.min(booked, leads) / leads) * 100) : 0,
    boughtRate: booked ? Math.round((bought / booked) * 100) : 0,
  };

  const channels = Object.entries(channelMix)
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count);

  // Addressable revenue inside the CRM (null unless both CRM + Finances are
  // enabled). The bridge keeps the two modules decoupled — purely additive.
  const revenue = await crmRevenueSummary(ctx);

  return {
    stats: {
      total,
      newCount,
      activeWeek,
      churned: stageCounts.Churned ?? 0,
      avgScore: total ? Math.round(scoreSum / total) : 0,
      stageCounts,
      funnelCounts,
      scoreBuckets,
      channels,
      temperature,
      revenue,
      response,
      conversion,
      range,
    },
  };
};
