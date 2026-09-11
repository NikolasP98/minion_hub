/**
 * Client-side calendar event store shared by every calendar surface. Holds
 * events keyed by id plus the set of already-loaded time spans, so
 * `ensure(from, to)` only fetches the sub-ranges it doesn't have yet (the
 * library's `datesSet` fires on every navigation, including ones that mostly
 * overlap what's already loaded).
 * Spec: minion-meta specs/2026-09-08-hub-scheduling-calendar-views-tags-spec.md §3.2 (pass 2).
 */
import { fetchJson } from '$lib/api/fetch-json';
import { toastError } from '$lib/state/ui';
import * as m from '$lib/paraglide/messages';
import type { CalEvent, CalKind, CalendarPayload } from './types';

/** LOCAL calendar date (not UTC — toISOString() rolls a late evening forward). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
/**
 * Same instant as `d`, as an ISO string with an explicit `±HH:MM` offset.
 * `@event-calendar/core` only honours an offset it can match with
 * `/([+-])(\d{2}):(\d{2})$/`, so a plain `toISOString()` ("…Z") makes it draw the
 * UTC digits verbatim. `+00:00` says the same thing in a form it parses — the
 * library then shifts to the viewer's own offset, exactly like the server's
 * `toOffsetIsoString` payloads.
 */
export function offsetIso(d: Date): string {
  return d.toISOString().replace('Z', '+00:00');
}
export function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

interface Span {
  from: number;
  to: number;
}

export class CalendarStore {
  events = $state<Record<string, CalEvent>>({});
  kinds = $state<CalKind[]>([]);
  /** Empty = all staff. */
  staff = $state<Set<string>>(new Set());
  kindId = $state<string | null>(null);

  #loaded: Span[] = [];
  #pending = new Set<string>();

  readonly defaultKind = $derived.by<CalKind | undefined>(
    () => this.kinds.find((k) => k.isDefault) ?? this.kinds[0],
  );

  /** Resolve an event's effective kind (null → the org default). */
  kindOf(event: CalEvent): CalKind | undefined {
    const id = event.kindId ?? this.defaultKind?.id;
    return id ? this.kinds.find((k) => k.id === id) : undefined;
  }

  readonly visible = $derived.by<CalEvent[]>(() => {
    const out: CalEvent[] = [];
    for (const e of Object.values(this.events)) {
      if (this.staff.size > 0 && !this.staff.has(e.resourceId)) continue;
      if (this.kindId && (e.kindId ?? this.defaultKind?.id) !== this.kindId) continue;
      out.push(e);
    }
    return out;
  });

  /** Merge a fetched (or page-loaded) window's events and mark it loaded. */
  mergeEvents(events: CalEvent[], from: string, to: string) {
    for (const e of events) this.events[e.id] = e;
    this.#addLoaded(Date.parse(from), Date.parse(to));
  }

  /** Apply a local patch (drag/resize confirm) without touching loaded spans. */
  patchEvent(id: string, patch: Partial<CalEvent>) {
    const existing = this.events[id];
    if (!existing) return;
    this.events[id] = { ...existing, ...patch };
  }

  setKinds(kinds: CalKind[]) {
    this.kinds = kinds;
  }

  /** Fetch only the missing sub-spans of `[from, to)`. One in-flight request per span. */
  async ensure(from: Date, to: Date): Promise<void> {
    const gaps = this.#missing(from.getTime(), to.getTime());
    await Promise.all(gaps.map((g) => this.#load(g.from, g.to)));
  }

  #missing(from: number, to: number): Span[] {
    const sorted = [...this.#loaded].sort((a, b) => a.from - b.from);
    const gaps: Span[] = [];
    let cursor = from;
    for (const span of sorted) {
      if (span.to <= cursor) continue;
      if (span.from >= to) break;
      if (span.from > cursor) gaps.push({ from: cursor, to: Math.min(span.from, to) });
      cursor = Math.max(cursor, span.to);
      if (cursor >= to) break;
    }
    if (cursor < to) gaps.push({ from: cursor, to });
    return gaps;
  }

  #addLoaded(from: number, to: number) {
    // ponytail: append + let #missing's sorted sweep treat overlaps as no-ops;
    // merging the list itself would save a handful of bytes, never measured.
    this.#loaded.push({ from, to });
  }

  async #load(fromMs: number, toMs: number) {
    if (toMs <= fromMs) return;
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();
    const key = `${fromIso}_${toIso}`;
    if (this.#pending.has(key)) return;
    this.#pending.add(key);
    try {
      const payload = await fetchJson<CalendarPayload>(
        `/api/scheduling/calendar?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
      );
      this.mergeEvents(payload.events, payload.from, payload.to);
    } catch {
      toastError(m.sched_cal_load_error());
    } finally {
      this.#pending.delete(key);
    }
  }
}
