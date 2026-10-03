/**
 * Scope-aware, week-bucketed data cache for the two infinite calendars.
 *
 * Every request has one cache-instance-unique owner. Invalidating an owner
 * removes it before aborting its transport, so a transport which ignores
 * AbortSignal (or never settles) cannot block or overwrite newer calendar
 * state. Server data enters through one explicit reconciliation boundary;
 * callers never expose a seed under a different organization/timezone scope.
 */
import { dateKeyFromParts, dateKeyWeekday, parseDateKey } from '$lib/time/zoned';
import { untrack } from 'svelte';
import { dayAt, mondayOf } from '../runway';

export type CalendarWindowStatus = 'loading' | 'ready' | 'error';

export interface CalendarWindowState {
  /** ISO Monday identifying the week. */
  key: string;
  from: string;
  to: string;
  status: CalendarWindowStatus;
  /** An authoritative seed or older fetched payload is still rendered. */
  hasData: boolean;
}

export interface CalendarWindowSnapshot<T> {
  /** Canonical active organization/timezone token; null fails closed. */
  activeScope: string | null;
  /** Scope captured by the server together with this seed payload. */
  seedScope: string | null;
  /** ISO days covered by the server seed, including empty weeks. */
  seedRange: readonly string[];
  /** Server payload already bucketed by ISO Monday. */
  seed: ReadonlyMap<string, T>;
}

export interface CalendarWindowFetchResult<T> {
  /** Scope resolved by the API after authenticating this exact request. */
  calendarScope: string | null;
  payload: T;
}

export interface CalendarWindowCacheConfig<T> {
  /** GET one ISO week (`from` through `to`, inclusive). */
  fetchWindow: (
    from: string,
    to: string,
    signal: AbortSignal,
  ) => Promise<CalendarWindowFetchResult<T>>;
  /** Merge every currently authoritative week into the rendered payload. */
  merge: (parts: T[]) => T;
  /** Fetched weeks retained either side of visibility. Defaults to four. */
  keepWeeks?: number;
  /** Current-owner failures only. Invalidated work is silent. */
  onError?: (error: unknown, key: string) => void;
  /** Logical read deadline. Defaults to 15 seconds; injectable for tests. */
  requestTimeoutMs?: number;
}

export interface CalendarWindowCache<T> {
  readonly data: T;
  /** Current logical owners plus replacements awaiting admission. */
  readonly busy: boolean;
  /** Visible weeks only; prefetch-only neighbours are intentionally absent. */
  readonly windows: CalendarWindowState[];
  /** Atomically apply active scope and the same-generation server seed. */
  reconcile(snapshot: CalendarWindowSnapshot<T>): void;
  /** Observe a range, optionally including one neighbouring week per side. */
  setVisibleRange(first: string, last: string, options: { prefetch: boolean }): void;
  /** Supersede every non-seeded observed read after a mutation refresh. */
  refetchVisible(): void;
  /** Retry one exact, visible ISO-Monday error. */
  retry(key: string): void;
  /** Permanently stop this route instance and release every retained owner. */
  dispose(): void;
}

interface RequestOwner {
  requestId: number;
  key: string;
  scope: string;
  controller: AbortController;
  deadline: ReturnType<typeof setTimeout> | null;
}

function weekEnd(monday: string): string {
  return dayAt(monday, 6);
}

/** `W(first) - pad ... W(last) + pad`, as ISO Mondays. */
function weekKeysAround(first: string, last: string, pad: number): string[] {
  const from = dayAt(mondayOf(first), -7 * pad);
  const to = dayAt(mondayOf(last), 7 * pad);
  const keys: string[] = [];
  for (let key = from; key <= to; key = dayAt(key, 7)) keys.push(key);
  return keys;
}

function validOrderedRange(first: string, last: string): boolean {
  const from = parseDateKey(first);
  const to = parseDateKey(last);
  if (!from || !to || first > last) return false;
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return toMs - fromMs <= 370 * 86_400_000;
}

function exactMonday(key: string): boolean {
  const parsed = parseDateKey(key);
  return parsed !== null && dateKeyFromParts(parsed) === key && dateKeyWeekday(key) === 1;
}

export function createCalendarWindowCache<T>(
  config: CalendarWindowCacheConfig<T>,
): CalendarWindowCache<T> {
  const keepWeeks = Number.isFinite(config.keepWeeks)
    ? Math.max(0, Math.floor(config.keepWeeks!))
    : 4;
  const requestTimeoutMs = Number.isFinite(config.requestTimeoutMs)
    ? Math.max(1, Math.floor(config.requestTimeoutMs!))
    : 15_000;

  let fetchedWeeks = $state(new Map<string, T>());
  let seedWeeks = $state(new Map<string, T>());
  let seededKeyList = $state<string[]>([]);
  let statusByKey = $state(new Map<string, CalendarWindowStatus>());
  let visibleKeyList = $state<string[]>([]);
  let busyCount = $state(0);

  let activeScope: string | null = null;
  let seededKeys = new Set<string>();
  let observedKeys = new Set<string>();
  let visibleKeys = new Set<string>();
  const active = new Map<string, RequestOwner>();
  const queuedReplacements = new Set<string>();
  let nextRequestId = 1;
  let admissionScheduled = false;
  let disposed = false;

  const weeks = $derived.by(() => {
    // Reading the key list makes authoritative empty seed weeks reactive too.
    void seededKeyList;
    const out = new Map(fetchedWeeks);
    for (const [key, value] of seedWeeks) out.set(key, value);
    return out;
  });
  const data = $derived(config.merge([...weeks.values()]));
  const windows = $derived.by(() =>
    visibleKeyList.map((key) => {
      const hasData = seededKeys.has(key) || fetchedWeeks.has(key);
      return {
        key,
        from: key,
        to: weekEnd(key),
        status: seededKeys.has(key)
          ? 'ready'
          : (statusByKey.get(key) ?? (hasData ? 'ready' : 'loading')),
        hasData,
      };
    }),
  );

  function syncBusy(): void {
    busyCount = active.size + queuedReplacements.size;
  }

  function replaceStatus(key: string, status: CalendarWindowStatus): void {
    statusByKey = new Map(statusByKey).set(key, status);
  }

  function deleteStatus(key: string): void {
    if (!statusByKey.has(key)) return;
    const next = new Map(statusByKey);
    next.delete(key);
    statusByKey = next;
  }

  /** Drop logical ownership before aborting. Late callbacks then fail identity. */
  function cancelOwner(key: string): void {
    const owner = active.get(key);
    if (!owner) return;
    active.delete(key);
    if (owner.deadline !== null) clearTimeout(owner.deadline);
    owner.deadline = null;
    owner.controller.abort();
  }

  function settleSuccess(owner: RequestOwner, result: CalendarWindowFetchResult<T>): void {
    if (
      active.get(owner.key) !== owner ||
      activeScope !== owner.scope ||
      !observedKeys.has(owner.key) ||
      seededKeys.has(owner.key)
    )
      return;

    if (result.calendarScope !== owner.scope) {
      settleFailure(owner, new Error('Calendar window scope changed.'), false);
      return;
    }

    active.delete(owner.key);
    if (owner.deadline !== null) clearTimeout(owner.deadline);
    owner.deadline = null;
    fetchedWeeks = new Map(fetchedWeeks).set(owner.key, result.payload);
    replaceStatus(owner.key, 'ready');
    syncBusy();
  }

  function settleFailure(owner: RequestOwner, error: unknown, abortTransport: boolean): void {
    if (
      active.get(owner.key) !== owner ||
      activeScope !== owner.scope ||
      !observedKeys.has(owner.key) ||
      seededKeys.has(owner.key)
    )
      return;

    active.delete(owner.key);
    if (owner.deadline !== null) clearTimeout(owner.deadline);
    owner.deadline = null;
    if (abortTransport) owner.controller.abort();
    replaceStatus(owner.key, 'error');
    syncBusy();
    try {
      config.onError?.(error, owner.key);
    } catch {
      // An optional observer cannot turn a contained read failure into an
      // unhandled rejection or revive the disposed route instance.
    }
  }

  function startFetch(key: string): void {
    const scope = activeScope;
    if (
      scope === null ||
      disposed ||
      !observedKeys.has(key) ||
      seededKeys.has(key) ||
      active.has(key) ||
      queuedReplacements.has(key)
    )
      return;

    const owner: RequestOwner = {
      requestId: nextRequestId++,
      key,
      scope,
      controller: new AbortController(),
      deadline: null,
    };
    active.set(key, owner);
    replaceStatus(key, 'loading');
    owner.deadline = setTimeout(() => {
      settleFailure(owner, new Error(`Calendar window ${key} timed out.`), true);
    }, requestTimeoutMs);
    syncBusy();

    let transport: Promise<CalendarWindowFetchResult<T>>;
    try {
      transport = Promise.resolve(config.fetchWindow(key, weekEnd(key), owner.controller.signal));
    } catch (error) {
      transport = Promise.reject(error);
    }
    void transport.then(
      (payload) => settleSuccess(owner, payload),
      (error) => settleFailure(owner, error, false),
    );
  }

  function loadMissingObserved(): void {
    for (const key of observedKeys) {
      if (
        seededKeys.has(key) ||
        fetchedWeeks.has(key) ||
        active.has(key) ||
        queuedReplacements.has(key) ||
        statusByKey.get(key) === 'error'
      )
        continue;
      startFetch(key);
    }
  }

  function flushAdmissions(): void {
    admissionScheduled = false;
    if (disposed) {
      queuedReplacements.clear();
      syncBusy();
      return;
    }
    const keys = [...queuedReplacements];
    queuedReplacements.clear();
    // Do not publish an intermediate zero: each eligible replacement becomes
    // an owner before busy is synchronized at the end of this admission turn.
    for (const key of keys) startFetch(key);
    syncBusy();
  }

  function scheduleAdmissions(): void {
    if (admissionScheduled) return;
    admissionScheduled = true;
    queueMicrotask(flushAdmissions);
  }

  function clearAll(clearObservation: boolean): void {
    queuedReplacements.clear();
    for (const key of [...active.keys()]) cancelOwner(key);
    fetchedWeeks = new Map();
    seedWeeks = new Map();
    seededKeys = new Set();
    seededKeyList = [];
    statusByKey = new Map();
    if (clearObservation) {
      observedKeys = new Set();
      visibleKeys = new Set();
      visibleKeyList = [];
    }
    syncBusy();
  }

  function reconcile(snapshot: CalendarWindowSnapshot<T>): void {
    if (disposed) return;
    if (snapshot.activeScope === null || snapshot.activeScope.length === 0) {
      activeScope = null;
      clearAll(true);
      return;
    }

    const scopeChanged = activeScope !== snapshot.activeScope;
    if (scopeChanged) {
      clearAll(false);
      activeScope = snapshot.activeScope;
    }

    const nextSeededKeys = new Set<string>();
    const nextSeedWeeks = new Map<string, T>();
    if (snapshot.seedScope === activeScope) {
      for (const day of snapshot.seedRange)
        if (parseDateKey(day) !== null) nextSeededKeys.add(mondayOf(day));
      for (const [key, payload] of snapshot.seed)
        if (nextSeededKeys.has(key)) nextSeedWeeks.set(key, payload);
    }

    const formerlySeeded = seededKeys;
    seededKeys = nextSeededKeys;
    seededKeyList = [...nextSeededKeys].sort();
    seedWeeks = nextSeedWeeks;

    const nextFetched = new Map(fetchedWeeks);
    let fetchedChanged = false;
    for (const key of nextSeededKeys) {
      if (nextFetched.delete(key)) fetchedChanged = true;
      queuedReplacements.delete(key);
      cancelOwner(key);
      replaceStatus(key, 'ready');
    }
    if (fetchedChanged) fetchedWeeks = nextFetched;

    for (const key of formerlySeeded) {
      if (nextSeededKeys.has(key)) continue;
      deleteStatus(key);
    }

    loadMissingObserved();
    syncBusy();
  }

  function setVisibleRange(first: string, last: string, options: { prefetch: boolean }): void {
    // BookingCalendar emits ranges from one of its own effects. Keep cache
    // reads out of that effect's dependency graph while applying the command.
    untrack(() => {
      if (disposed) return;
      if (!validOrderedRange(first, last)) return;
      if (activeScope === null) {
        observedKeys = new Set();
        visibleKeys = new Set();
        visibleKeyList = [];
        return;
      }

      const nextVisible = new Set(weekKeysAround(first, last, 0));
      const nextObserved = new Set(weekKeysAround(first, last, options.prefetch ? 1 : 0));
      visibleKeys = nextVisible;
      visibleKeyList = [...nextVisible];

      for (const key of observedKeys) {
        if (nextObserved.has(key)) continue;
        queuedReplacements.delete(key);
        cancelOwner(key);
        deleteStatus(key);
      }
      observedKeys = nextObserved;

      const min = dayAt(mondayOf(first), -7 * keepWeeks);
      const max = dayAt(mondayOf(last), 7 * keepWeeks);
      const retained = new Map([...fetchedWeeks].filter(([key]) => key >= min && key <= max));
      if (retained.size !== fetchedWeeks.size) fetchedWeeks = retained;

      loadMissingObserved();
      syncBusy();
    });
  }

  function refetchVisible(): void {
    if (disposed || activeScope === null || observedKeys.size === 0) return;

    let nextStatus = new Map(statusByKey);
    for (const key of observedKeys) {
      if (seededKeys.has(key)) continue;
      // Queue first, then invalidate. `busy` therefore remains true even when
      // the old transport ignores abort and never settles.
      queuedReplacements.add(key);
      nextStatus.set(key, 'loading');
      syncBusy();
      cancelOwner(key);
    }
    statusByKey = nextStatus;
    syncBusy();
    if (queuedReplacements.size > 0) scheduleAdmissions();
  }

  function retry(key: string): void {
    if (
      disposed ||
      activeScope === null ||
      !exactMonday(key) ||
      !visibleKeys.has(key) ||
      !observedKeys.has(key) ||
      statusByKey.get(key) !== 'error' ||
      active.has(key) ||
      queuedReplacements.has(key)
    )
      return;
    startFetch(key);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    activeScope = null;
    admissionScheduled = false;
    clearAll(true);
  }

  return {
    get data() {
      return data;
    },
    get busy() {
      return busyCount > 0;
    },
    get windows() {
      return windows;
    },
    reconcile,
    setVisibleRange,
    refetchVisible,
    retry,
    dispose,
  };
}
