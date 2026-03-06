/**
 * State module for skill execution statistics.
 *
 * The summary endpoint returns { bySkill: [{ skillName, status, count, avgDurationMs }] }
 * grouped by (skillName, status).
 */

export type SkillStatus = 'ok' | 'auth_error' | 'timeout' | 'error';

export interface SkillStatRow {
  skillName: string;
  status: SkillStatus;
  count: number;
  avgDurationMs: number | null;
}

/** Aggregated view per skill across all statuses. */
export interface SkillAggregate {
  skillName: string;
  total: number;
  byStatus: Partial<Record<SkillStatus, number>>;
  avgDurationMs: number | null;
}

export function createSkillStatsState() {
  let bySkill = $state<SkillStatRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load(serverId: string) {
    loading = true;
    error = null;
    try {
      const res = await globalThis.fetch(
        `/api/metrics/skill-stats?serverId=${encodeURIComponent(serverId)}&summary=true`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      bySkill = data.bySkill ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  /** Aggregate rows into per-skill summaries, sorted by total descending. */
  function aggregate(): SkillAggregate[] {
    const map = new Map<string, SkillAggregate>();

    for (const row of bySkill) {
      let agg = map.get(row.skillName);
      if (!agg) {
        agg = { skillName: row.skillName, total: 0, byStatus: {}, avgDurationMs: null };
        map.set(row.skillName, agg);
      }
      agg.total += row.count;
      agg.byStatus[row.status] = (agg.byStatus[row.status] ?? 0) + row.count;
      // Weighted average duration
      if (row.avgDurationMs != null) {
        const prevWeight = agg.avgDurationMs != null ? agg.total - row.count : 0;
        const prevAvg = agg.avgDurationMs ?? 0;
        agg.avgDurationMs = (prevAvg * prevWeight + row.avgDurationMs * row.count) / agg.total;
      }
    }

    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  return {
    get bySkill() {
      return bySkill;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    load,
    aggregate,
  };
}
