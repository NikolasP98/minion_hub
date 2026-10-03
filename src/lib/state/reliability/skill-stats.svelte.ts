/** Owner-fenced skill execution statistics. */
import { createAsyncResource } from '../async.svelte';
import { finite, integer, record, rows, string } from './decode-primitives';
import { fetchReliabilityJson } from './http-read';
import { createReadFailureMonitor } from './read-monitor';
import type { ReliabilityHttpOwner } from './view-owner';

export type SkillStatus = 'ok' | 'auth_error' | 'timeout' | 'error';

export interface SkillStatRow {
  skillName: string;
  status: SkillStatus;
  count: number;
  /** Missing on old responses. Missing/zero means duration is unknown. */
  durationCount?: number;
  avgDurationMs: number | null;
  minDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface SkillAggregate {
  skillName: string;
  total: number;
  byStatus: Partial<Record<SkillStatus, number>>;
  durationCount: number;
  avgDurationMs: number | null;
  minDurationMs: number | null;
  maxDurationMs: number | null;
}

const STATUSES = new Set<SkillStatus>(['ok', 'auth_error', 'timeout', 'error']);

function duration(raw: unknown): number | null {
  if (raw === null) return null;
  const value = finite(raw);
  if (value < 0) throw new Error('Invalid skill duration');
  return value;
}

export function decodeSkillRows(raw: unknown): SkillStatRow[] {
  const envelope = record(raw);
  const decoded = rows(
    envelope.bySkill,
    (rawRow) => {
      const row = record(rawRow);
      const status = string(row.status) as SkillStatus;
      if (!STATUSES.has(status)) throw new Error('Invalid skill status');
      const count = integer(row.count);
      const durationCount =
        row.durationCount === undefined ? undefined : integer(row.durationCount);
      if (durationCount !== undefined && durationCount > count) {
        throw new Error('Invalid skill duration count');
      }
      const avgDurationMs = duration(row.avgDurationMs);
      const minDurationMs = duration(row.minDurationMs);
      const maxDurationMs = duration(row.maxDurationMs);
      if (
        durationCount !== undefined &&
        ((durationCount === 0 &&
          (avgDurationMs !== null || minDurationMs !== null || maxDurationMs !== null)) ||
          (durationCount > 0 &&
            (avgDurationMs === null || minDurationMs === null || maxDurationMs === null)))
      ) {
        throw new Error('Inconsistent skill duration aggregate');
      }
      if (
        durationCount !== undefined &&
        durationCount > 0 &&
        minDurationMs !== null &&
        avgDurationMs !== null &&
        maxDurationMs !== null &&
        (minDurationMs > avgDurationMs || avgDurationMs > maxDurationMs)
      ) {
        throw new Error('Invalid skill duration ordering');
      }
      return {
        skillName: string(row.skillName),
        status,
        count,
        ...(durationCount === undefined ? {} : { durationCount }),
        avgDurationMs,
        minDurationMs,
        maxDurationMs,
      };
    },
    2000,
  );
  const keys = decoded.map((row) => `${row.skillName}\u0000${row.status}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate skill aggregate');
  return decoded;
}

function addSafe(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error('Skill aggregate exceeds numeric bounds');
  return result;
}

export function aggregateSkillRows(input: readonly SkillStatRow[]): SkillAggregate[] {
  const map = new Map<string, SkillAggregate>();
  for (const row of input) {
    let aggregate = map.get(row.skillName);
    if (!aggregate) {
      aggregate = {
        skillName: row.skillName,
        total: 0,
        byStatus: {},
        durationCount: 0,
        avgDurationMs: null,
        minDurationMs: null,
        maxDurationMs: null,
      };
      map.set(row.skillName, aggregate);
    }
    aggregate.total = addSafe(aggregate.total, row.count);
    aggregate.byStatus[row.status] = addSafe(aggregate.byStatus[row.status] ?? 0, row.count);
    const measured = row.durationCount;
    if (measured !== undefined && measured > 0 && row.avgDurationMs !== null) {
      const nextDurationCount = addSafe(aggregate.durationCount, measured);
      aggregate.avgDurationMs =
        aggregate.avgDurationMs === null
          ? row.avgDurationMs
          : aggregate.avgDurationMs +
            (row.avgDurationMs - aggregate.avgDurationMs) * (measured / nextDurationCount);
      if (!Number.isFinite(aggregate.avgDurationMs) || aggregate.avgDurationMs < 0) {
        throw new Error('Skill duration aggregate exceeds numeric bounds');
      }
      aggregate.durationCount = nextDurationCount;
      if (row.minDurationMs !== null) {
        aggregate.minDurationMs =
          aggregate.minDurationMs === null
            ? row.minDurationMs
            : Math.min(aggregate.minDurationMs, row.minDurationMs);
      }
      if (row.maxDurationMs !== null) {
        aggregate.maxDurationMs =
          aggregate.maxDurationMs === null
            ? row.maxDurationMs
            : Math.max(aggregate.maxDurationMs, row.maxDurationMs);
      }
    }
  }
  return [...map.values()].sort(
    (a, b) => b.total - a.total || a.skillName.localeCompare(b.skillName),
  );
}

export function createSkillStatsState(owner: () => ReliabilityHttpOwner | null) {
  const monitor = createReadFailureMonitor('skillStats');
  let controller: AbortController | null = null;
  let lastServerId: string | null = null;
  const resource = createAsyncResource<
    SkillStatRow[],
    [ReliabilityHttpOwner | null, string, AbortSignal]
  >(
    async (captured, serverId, signal) => {
      if (!captured) throw new Error('Skill statistics unavailable');
      let phase: 'transport' | 'decode' = 'transport';
      try {
        const params = new URLSearchParams({ serverId, summary: 'true' });
        const raw = await fetchReliabilityJson(`/api/metrics/skill-stats?${params}`, signal);
        phase = 'decode';
        const result = decodeSkillRows(raw);
        return result;
      } catch (error) {
        if (captured.current()) monitor.failed(captured.token, phase);
        throw error;
      }
    },
    {
      initialLoading: true,
      formatError: () => 'Skill statistics could not be refreshed.',
      owner: (captured) => captured,
      key: (_captured, serverId) => serverId,
      beforePublish: (_rows, captured) => captured && monitor.ready(),
    },
  );

  async function load(serverId: string): Promise<void> {
    lastServerId = serverId;
    controller?.abort();
    controller = new AbortController();
    await resource.load(owner(), serverId, controller.signal);
  }
  function reset(): void {
    controller?.abort();
    controller = null;
    resource.reset();
  }
  return {
    get bySkill() {
      return resource.data ?? [];
    },
    get loading() {
      return resource.loading;
    },
    get error() {
      return resource.error;
    },
    get status() {
      return resource.status;
    },
    load,
    retry: () => (lastServerId ? load(lastServerId) : Promise.resolve()),
    reset,
    aggregate: () => aggregateSkillRows(resource.data ?? []),
  };
}
