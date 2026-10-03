import type { GatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
import { createReliabilityResource } from './owned-resource.svelte';
import {
  decodeSummary,
  normalizeReliabilityEvent,
  reliabilityParams,
  decodeEvents,
  decodeTimeline,
  decodeFlow,
  decodeUsage,
  decodeActivity,
  decodePerf,
} from './read-contract';
import type { ReliabilityFilters } from './read-contract';
import type {
  ActivityAggregate,
  PerfSeries,
  ReliabilityEvent,
  ReliabilitySummary,
  UsageAggregate,
} from './types';
export type * from './types';
export type { ReliabilityFilters } from './read-contract';

type Flow = { event: string; category: string; severity: string; count: number }[];
type Timeline = {
  buckets: { bucket: number; category: string; count: number }[];
  bucketMs: number;
};
const resources = {
  summary: createReliabilityResource<ReliabilitySummary>('summary'),
  summaryAll: createReliabilityResource<ReliabilitySummary>('summaryAll'),
  events: createReliabilityResource<ReliabilityEvent[]>('events'),
  timeline: createReliabilityResource<Timeline>('timeline'),
  flow: createReliabilityResource<Flow>('flow'),
  usage: createReliabilityResource<UsageAggregate>('usage'),
  activity: createReliabilityResource<ActivityAggregate>('activity'),
  perf: createReliabilityResource<PerfSeries>('perf'),
};
export type ReliabilityResourceName = keyof typeof resources;
let activeOwner: GatewaySessionOwner | null = null;
let recentOwner: symbol | null = null;
let recentSessionOwner: GatewaySessionOwner | null = null;
let queryKeys: { date: () => string; filtered: () => string } | null = null;

/** Capture the visible query, including changes before Svelte flushes its next effect. */
export function setReliabilityQueryKeys(keys: typeof queryKeys): void {
  queryKeys = keys;
}
function readOwner(group: 'date' | 'filtered'): GatewaySessionOwner | null {
  const owner = activeOwner;
  const keys = queryKeys;
  const key = keys?.[group]();
  return owner
    ? {
        ...owner,
        current: () => owner.current() && (!keys || (queryKeys === keys && keys[group]() === key)),
      }
    : null;
}
let sampleFilters: ReliabilityFilters = {};
const recent = $state({ events: [] as ReliabilityEvent[] });
const dateRange = $state({ from: Date.now() - 86400000, to: Date.now() });
const liveListeners = new Set<(owner: GatewaySessionOwner, event: ReliabilityEvent) => void>();

/** Public data names remain compatible; endpoint state now has independent ownership. */
export const reliability = {
  get recentEvents() {
    // Always read the reactive row set so a first event wakes consumers even
    // though the session owner is still null during their initial evaluation.
    const events = recent.events;
    return recentSessionOwner?.current() && recentSessionOwner.token === recentOwner ? events : [];
  },
  get summary() {
    return resources.summary.value;
  },
  get summaryAll() {
    return resources.summaryAll.value;
  },
  get events() {
    return resources.events.value ?? [];
  },
  get timeline() {
    return resources.timeline.value;
  },
  get flow() {
    return resources.flow.value;
  },
  get usage() {
    return resources.usage.value;
  },
  get activity() {
    return resources.activity.value;
  },
  get perf() {
    return resources.perf.value;
  },
  get loading() {
    return Object.values(resources).some((resource) => resource.status === 'loading');
  },
  get states() {
    return Object.fromEntries(
      Object.entries(resources).map(([key, resource]) => [key, resource.status]),
    );
  },
  dateRange,
};

export function resetReliability(): void {
  activeOwner = null;
  recentOwner = null;
  recentSessionOwner = null;
  recent.events = [];
  sampleFilters = {};
  for (const resource of Object.values(resources)) resource.reset();
}

/** The page supplies a session only after matching its canonical actor and organization. */
export function setReliabilityOwner(owner: GatewaySessionOwner | null): void {
  if (activeOwner?.token === owner?.token) return;
  resetReliability();
  activeOwner = owner?.current() ? owner : null;
}

export function setReliabilitySampleFilters(filters: ReliabilityFilters): void {
  sampleFilters = { severities: filters.severities, categories: filters.categories };
}

export function subscribeReliabilityLive(
  listener: (owner: GatewaySessionOwner, event: ReliabilityEvent) => void,
): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

/** Live rows are samples, never arithmetic updates to uncorrelated server aggregates. */
export function pushReliabilityEvent(raw: unknown, owner?: GatewaySessionOwner): void {
  if (!owner?.current()) return;
  let event: ReliabilityEvent;
  try {
    event = normalizeReliabilityEvent(raw);
  } catch {
    return;
  }
  if (recentOwner !== owner.token) recent.events = [];
  recentOwner = owner.token;
  recentSessionOwner = owner;
  recent.events = [...recent.events.slice(-199), event];
  // Panel subscribers own their range/filter checks. Notify them before the
  // page-level sample gate so a panel's live pulse is not coupled to a stale
  // coordinator date range during query transitions.
  for (const listener of liveListeners) if (owner.current()) listener(owner, event);
  if (activeOwner?.token !== owner.token || !activeOwner.current()) return;
  if (event.timestamp < dateRange.from || event.timestamp > dateRange.to) return;
  const matches =
    (!sampleFilters.severities?.length || sampleFilters.severities.includes(event.severity)) &&
    (!sampleFilters.categories?.length || sampleFilters.categories.includes(event.category));
  if (matches && resources.events.value !== null) {
    const existing = resources.events.value.filter(
      (row) => event.id === undefined || row.id !== event.id,
    );
    resources.events.replace(
      [event, ...existing].sort((a, b) => b.timestamp - a.timestamp).slice(0, 2000),
    );
  }
}

export function loadReliabilitySummary(
  _serverId: string,
  from?: number,
  to?: number,
  filters?: ReliabilityFilters,
) {
  return resources.summary.load(
    readOwner('filtered'),
    'reliability.summary',
    reliabilityParams(from, to, filters),
    decodeSummary,
  );
}

export function loadReliabilitySummaryAll(_serverId: string, from?: number, to?: number) {
  return resources.summaryAll.load(
    readOwner('date'),
    'reliability.summary',
    reliabilityParams(from, to),
    decodeSummary,
  );
}

export function loadReliabilityEvents(
  _serverId: string,
  opts?: ReliabilityFilters & { category?: string; from?: number; to?: number; limit?: number },
) {
  const params = {
    ...reliabilityParams(opts?.from, opts?.to, opts),
    limit: 2000,
    ...(opts?.category ? { category: opts.category } : {}),
  };
  return resources.events.load(readOwner('filtered'), 'reliability.events', params, decodeEvents);
}

export function loadReliabilityTimeline(from: number, to: number, filters?: ReliabilityFilters) {
  return resources.timeline.load(
    readOwner('filtered'),
    'reliability.timeline',
    reliabilityParams(from, to, filters),
    decodeTimeline,
  );
}

export function loadReliabilityFlow(from: number, to: number, filters?: ReliabilityFilters) {
  return resources.flow.load(
    readOwner('filtered'),
    'reliability.flow',
    reliabilityParams(from, to, filters),
    decodeFlow,
  );
}

export function loadReliabilityUsage(from: number, to: number) {
  return resources.usage.load(
    readOwner('date'),
    'reliability.usage',
    reliabilityParams(from, to),
    decodeUsage,
  );
}

export function loadReliabilityActivity(from: number, to: number) {
  return resources.activity.load(
    readOwner('date'),
    'reliability.activity',
    reliabilityParams(from, to),
    decodeActivity,
  );
}

export function loadReliabilityPerf(from: number, to: number) {
  return resources.perf.load(
    readOwner('date'),
    'reliability.perf',
    reliabilityParams(from, to),
    decodePerf,
  );
}
