import { onDestroy, untrack } from 'svelte';
import type { GatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
import { createReliabilityLiveRefresh } from './live-refresh';
import { normalizedFilter, type ReliabilityFilters } from './read-contract';
import {
  loadReliabilityActivity,
  loadReliabilityEvents,
  loadReliabilityFlow,
  loadReliabilityPerf,
  loadReliabilitySummary,
  loadReliabilitySummaryAll,
  loadReliabilityTimeline,
  loadReliabilityUsage,
  setReliabilityOwner,
  setReliabilityQueryKeys,
  setReliabilitySampleFilters,
  subscribeReliabilityLive,
} from './reliability.svelte';

export interface ReliabilityQuery extends ReliabilityFilters {
  from: number;
  to: number;
}

/** A single reactive owner replaces the former mount batch plus duplicate effects. */
export function createReliabilityCoordinator(options: {
  ready: () => boolean;
  owner: () => GatewaySessionOwner | null;
  query: () => ReliabilityQuery;
}) {
  const normalizedQuery = () => {
    const raw = options.query();
    return {
      from: raw.from,
      to: raw.to,
      severities: normalizedFilter(raw.severities),
      categories: normalizedFilter(raw.categories),
      eventModes: normalizedFilter(raw.eventModes),
    };
  };
  const queryKeys = {
    date: () => {
      const q = options.query();
      return JSON.stringify([q.from, q.to]);
    },
    filtered: () => JSON.stringify(normalizedQuery()),
  };
  setReliabilityQueryKeys(queryKeys);
  let stopped = false;
  let epoch = 0;
  let previousOwner: symbol | null = null;
  let previousDateKey = '';
  let previousFilteredKey = '';
  let refreshCurrent: (() => Promise<unknown>) | null = null;
  let live: ReturnType<typeof createReliabilityLiveRefresh> | null = null;
  const unsubscribe = subscribeReliabilityLive((owner, event) => {
    const query = options.query();
    if (
      event.timestamp >= query.from &&
      event.timestamp <= query.to &&
      owner.current() &&
      owner.token === previousOwner
    ) {
      live?.notify();
    }
  });

  $effect(() => {
    const ready = options.ready();
    const owner = options.owner();
    const raw = options.query();
    const query: ReliabilityQuery = {
      from: raw.from,
      to: raw.to,
      severities: normalizedFilter(raw.severities),
      categories: normalizedFilter(raw.categories),
      eventModes: normalizedFilter(raw.eventModes),
    };
    const dateKey = JSON.stringify([query.from, query.to]);
    const filteredKey = JSON.stringify(query);
    untrack(() => {
      if (!ready || !owner?.current() || stopped) {
        epoch++;
        live?.dispose();
        live = null;
        refreshCurrent = null;
        previousOwner = null;
        previousDateKey = previousFilteredKey = '';
        setReliabilityOwner(null);
        return;
      }
      const ownerChanged = previousOwner !== owner.token;
      const dateChanged = ownerChanged || previousDateKey !== dateKey;
      const filteredChanged = ownerChanged || previousFilteredKey !== filteredKey;
      if (!dateChanged && !filteredChanged) return;
      const generation = ++epoch;
      const current = () =>
        !stopped && epoch === generation && owner.current() && queryKeys.filtered() === filteredKey;
      previousOwner = owner.token;
      previousDateKey = dateKey;
      previousFilteredKey = filteredKey;
      setReliabilityOwner(owner);
      setReliabilitySampleFilters(query);
      const dateReads = () =>
        Promise.all([
          loadReliabilitySummaryAll(owner.hostId, query.from, query.to),
          loadReliabilityUsage(query.from, query.to),
          loadReliabilityActivity(query.from, query.to),
          loadReliabilityPerf(query.from, query.to),
        ]);
      const filteredReads = () =>
        Promise.all([
          loadReliabilitySummary(owner.hostId, query.from, query.to, query),
          loadReliabilityTimeline(query.from, query.to, query),
          loadReliabilityFlow(query.from, query.to, query),
          loadReliabilityEvents(owner.hostId, {
            from: query.from,
            to: query.to,
            severities: query.severities,
            categories: query.categories,
          }),
        ]);
      live?.dispose();
      live = createReliabilityLiveRefresh({
        current,
        refresh: () => Promise.all([dateReads(), filteredReads()]),
      });
      refreshCurrent = () => live?.run() ?? Promise.resolve();
      void live.run(() =>
        Promise.all([
          dateChanged ? dateReads() : undefined,
          filteredChanged ? filteredReads() : undefined,
        ]),
      );
    });
  });

  onDestroy(() => {
    stopped = true;
    epoch++;
    live?.dispose();
    unsubscribe();
    setReliabilityOwner(null);
    setReliabilityQueryKeys(null);
  });

  return { refresh: () => refreshCurrent?.() ?? Promise.resolve() };
}
