import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listContactsCached } from '$server/services/crm-contacts.service';
import { FUNNEL_ORDER, effectiveFunnelStage } from '$lib/components/crm/crm-funnel';

const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'] as const;

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:contacts');

  // Reuse the same Valkey-cached roster the Customers list loads, then aggregate
  // server-side into a COMPACT summary — the dashboard never ships the full
  // roster (that 941 KB payload is what makes the list page heavy), only counts
  // and a short recent-activity slice.
  const all = await listContactsCached(ctx);
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

  for (const c of all) {
    if (c.stage in stageCounts) stageCounts[c.stage]++;
    const b = Math.min(9, Math.max(0, Math.floor(c.score / 10)));
    scoreBuckets[b]++;
    scoreSum += c.score;
    for (const ch of c.channels ?? []) channelMix[ch] = (channelMix[ch] ?? 0) + 1;
    if (c.first_contact_at && now - Date.parse(c.first_contact_at) <= THIRTY_DAYS) newCount++;
    if (c.last_contact_at && now - Date.parse(c.last_contact_at) <= SEVEN_DAYS) activeWeek++;
    const fs = effectiveFunnelStage(c.custom_fields, { inbound: c.inbound_msgs });
    if (fs) funnelCounts[fs]++;
  }

  const channels = Object.entries(channelMix)
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count);

  // Most-recently-contacted customers (compact slice for the activity feed).
  const recent = [...all]
    .filter((c) => c.last_contact_at)
    .sort((a, b) => Date.parse(b.last_contact_at!) - Date.parse(a.last_contact_at!))
    .slice(0, 8)
    .map((c) => ({
      contact_id: c.contact_id,
      display_name: c.display_name,
      last_contact_at: c.last_contact_at,
      channels: c.channels ?? [],
      stage: c.stage,
      score: c.score,
    }));

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
      recent,
    },
  };
};
