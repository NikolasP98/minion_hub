/**
 * Telemetry retention for the hub-owned Turso tables. The gateway prunes only its
 * LOCAL edge SQLite — the remote `unified_events` / `gateway_heartbeats` grew
 * ~3-6k rows/day unbounded (see specs/2026-07-17-telemetry-cleanup-and-insights.md).
 * The hub owns these tables and is the only place that can prune across every
 * writer, so retention runs here (a CRON_SECRET tick), not in the gateway.
 *
 * Signal-preserving tiers (v1 = prune, no rollup — old info/low rows carry ~no
 * value; the aggregate view lives in the Insights tab):
 *   - NEVER deleted: high/critical/medium severity, `agent.llm.usage` (cost
 *     history), and any `*.error`/`*.failure` event.
 *   - info/low in the firehose categories (gateway/heartbeat/auth) → keep 30d.
 *   - info/low everywhere else (agent/memory/tool/channel/skill/…) → keep 90d.
 *   - `gateway_heartbeats` (latest-wins vitals) → keep 30d.
 *
 * Dry-run by default: `runRetention()` reports what WOULD be deleted; pass
 * `apply: true` to actually delete. A destructive first pass on shared prod is
 * intentionally gated behind that flag + the CRON_SECRET route.
 */
import { and, eq, ne, lt, inArray, notInArray, notLike, sql } from 'drizzle-orm';
import { unifiedEvents, gatewayHeartbeats } from '@minion-stack/db/schema';
import { getDb } from '$server/db/client';

const DAY = 86_400_000;
const FIREHOSE_CATEGORIES = ['gateway', 'heartbeat', 'auth'];
const HOT_DAYS = 30; // firehose info/low
const COLD_DAYS = 90; // other info/low
const HEARTBEAT_DAYS = 30;

/** Rows eligible for deletion: only info/low noise, never cost or error/failure. */
function deletable() {
  return and(
    inArray(unifiedEvents.severity, ['info', 'low']),
    ne(unifiedEvents.event, 'agent.llm.usage'),
    notLike(unifiedEvents.event, '%.error'),
    notLike(unifiedEvents.event, '%.failure'),
  );
}

export interface RetentionTier {
  label: string;
  count: number;
}
export interface RetentionResult {
  now: number;
  applied: boolean;
  tiers: RetentionTier[];
  total: number;
}

export async function runRetention(
  opts: { apply?: boolean; now?: number } = {},
): Promise<RetentionResult> {
  const { apply = false, now = Date.now() } = opts;
  const db = getDb();

  const tierAWhere = and(
    deletable(),
    inArray(unifiedEvents.category, FIREHOSE_CATEGORIES),
    lt(unifiedEvents.occurredAt, now - HOT_DAYS * DAY),
  );
  const tierBWhere = and(
    deletable(),
    notInArray(unifiedEvents.category, FIREHOSE_CATEGORIES),
    lt(unifiedEvents.occurredAt, now - COLD_DAYS * DAY),
  );
  const hbWhere = lt(gatewayHeartbeats.capturedAt, now - HEARTBEAT_DAYS * DAY);

  const labelA = `unified_events info/low [${FIREHOSE_CATEGORIES.join(',')}] > ${HOT_DAYS}d`;
  const labelB = `unified_events info/low [other categories] > ${COLD_DAYS}d`;
  const labelH = `gateway_heartbeats > ${HEARTBEAT_DAYS}d`;

  if (!apply) {
    const [a, b, h] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(unifiedEvents).where(tierAWhere),
      db.select({ c: sql<number>`count(*)` }).from(unifiedEvents).where(tierBWhere),
      db.select({ c: sql<number>`count(*)` }).from(gatewayHeartbeats).where(hbWhere),
    ]);
    const tiers = [
      { label: labelA, count: Number(a[0]?.c ?? 0) },
      { label: labelB, count: Number(b[0]?.c ?? 0) },
      { label: labelH, count: Number(h[0]?.c ?? 0) },
    ];
    return { now, applied: false, tiers, total: tiers.reduce((s, t) => s + t.count, 0) };
  }

  // Apply. Sequential (not Promise.all) so a mid-run failure leaves a coherent
  // partial prune rather than three racing writers on the same table.
  const ra = await db.delete(unifiedEvents).where(tierAWhere);
  const rb = await db.delete(unifiedEvents).where(tierBWhere);
  const rh = await db.delete(gatewayHeartbeats).where(hbWhere);
  const tiers = [
    { label: labelA, count: ra.rowsAffected ?? 0 },
    { label: labelB, count: rb.rowsAffected ?? 0 },
    { label: labelH, count: rh.rowsAffected ?? 0 },
  ];
  return { now, applied: true, tiers, total: tiers.reduce((s, t) => s + t.count, 0) };
}
