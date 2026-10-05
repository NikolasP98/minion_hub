import type { ReliabilityEvent, ReliabilitySummary } from './types';
import { countMap, metadata, number, record, rows, string } from './decode-primitives';
export { decodeUsage, decodeActivity } from './read-aggregates';
export { decodePerf } from './read-performance';
export { record as responseRecord } from './decode-primitives';

export interface ReliabilityFilters {
  severities?: string[];
  categories?: string[];
  eventModes?: string[];
}

export function normalizedFilter(values?: readonly string[]): string[] | undefined {
  const result = [...new Set(values ?? [])].sort();
  return result.length ? result : undefined;
}

export function reliabilityParams(from?: number, to?: number, filters?: ReliabilityFilters) {
  const params: Record<string, unknown> = {};
  if (from !== undefined) params.since = from;
  if (to !== undefined) params.until = to;
  for (const key of ['severities', 'categories', 'eventModes'] as const) {
    const normalized = normalizedFilter(filters?.[key]);
    if (normalized) params[key] = normalized;
  }
  return params;
}

export function decodeSummary(raw: unknown): ReliabilitySummary {
  const data = record(raw);
  return {
    total: number(data.total),
    uptimeSinceMs: data.uptimeSinceMs === undefined ? undefined : number(data.uptimeSinceMs),
    byCategory: countMap(data.byCategory),
    bySeverity: countMap(data.bySeverity),
  };
}

export function normalizeReliabilityEvent(raw: unknown): ReliabilityEvent {
  const event = record(raw);
  const timestamp = event.timestamp ?? event.occurredAt;
  if (
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    typeof event.category !== 'string' ||
    typeof event.severity !== 'string' ||
    typeof event.event !== 'string' ||
    typeof event.message !== 'string'
  )
    throw new Error('Invalid reliability event');
  return {
    timestamp: number(timestamp),
    category: string(event.category),
    severity: string(event.severity),
    event: string(event.event),
    message: string(event.message, 16_384),
    ...(event.id === undefined ? {} : { id: number(event.id) }),
    ...(event.agentId === undefined ? {} : { agentId: string(event.agentId) }),
    ...(event.correlationId === undefined
      ? {}
      : { correlationId: string(event.correlationId, 2048) }),
    ...(event.metadata == null ? {} : { metadata: metadata(event.metadata) }),
  };
}

export function decodeEvents(raw: unknown): ReliabilityEvent[] {
  return rows(record(raw).events, normalizeReliabilityEvent, 2000);
}

export function decodeTimeline(raw: unknown) {
  const data = record(raw);
  const bucketMs = number(data.bucketMs);
  if (bucketMs === 0) throw new Error('Invalid reliability bucket width');
  return {
    bucketMs,
    buckets: rows(data.buckets, (raw) => {
      const row = record(raw);
      return {
        bucket: number(row.bucket),
        category: string(row.category),
        count: number(row.count),
      };
    }),
  };
}

export function decodeFlow(raw: unknown) {
  return rows(record(raw).rows, (raw) => {
    const row = record(raw);
    return {
      event: string(row.event),
      category: string(row.category),
      severity: string(row.severity),
      count: number(row.count),
    };
  });
}
