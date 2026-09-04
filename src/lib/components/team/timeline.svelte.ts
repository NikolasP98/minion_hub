/**
 * Roster timeline state — ONE horizontal scroll owner (the header cell) shared
 * by every row of the People table. Rows mirror `offset` with a translate, so
 * day columns line up under a single set of day headers. The window is ±45
 * days around today and grows by 30 days when the header scrolls within 7
 * days of an edge (bookings for the new span are fetched on demand).
 */
import { tick } from 'svelte';
import { fetchJson } from '$lib/api/fetch-json';
import type { LeaveStatus, TeamBooking, TeamHoliday, TeamLeaveRequest } from './types';
import { todayKey } from './types';

export const DAY_PX = 40;
const PAD = 45;
const STEP = 30;
const EDGE = 7;

export interface TimelineDay {
  key: string;
  num: number;
  /** Short weekday (ddd). */
  label: string;
  monthStart: boolean;
  today: boolean;
  /** Recurring weekly off. */
  off: boolean;
  /** Enabled holiday name, when the org observes one that day. */
  holiday: string | null;
}

/** One calendar month inside the window — the header's sticky month label rides on it. */
export interface TimelineMonth {
  key: string;
  label: string;
  days: number;
}

export interface LeaveMark {
  request: TeamLeaveRequest;
  status: LeaveStatus;
  first: boolean;
  last: boolean;
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const localKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const EMPTY: TeamBooking[] = [];

export class Timeline {
  start = $state(addDays(todayKey(), -PAD));
  count = $state(PAD * 2 + 1);
  offset = $state(0);
  /** Inputs the People view keeps in sync with its props. */
  leaves = $state<TeamLeaveRequest[]>([]);
  holidays = $state<TeamHoliday[]>([]);
  weeklyOff = $state<number[]>([]);
  locale = $state('en');
  /** Names for tooltips (the People view wires these from its props). */
  leaveTypeName = $state<(id: string) => string>(() => '');
  eventTitle = $state<(id: string) => string>(() => '');

  #bookings = $state<Record<string, TeamBooking>>({});
  #loadedFrom = '';
  #loadedTo = '';
  #el: HTMLDivElement | null = null;
  #extending = false;

  readonly end = $derived(addDays(this.start, this.count - 1));

  readonly days = $derived.by<TimelineDay[]>(() => {
    const today = todayKey();
    const off = new Set(this.weeklyOff);
    const hol = new Map(this.holidays.filter((h) => h.enabled).map((h) => [h.date, h.name]));
    const wd = new Intl.DateTimeFormat(this.locale, { weekday: 'short' });
    const out: TimelineDay[] = [];
    const d = new Date(`${this.start}T00:00:00`);
    for (let i = 0; i < this.count; i++, d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const monthStart = d.getDate() === 1;
      out.push({
        key,
        num: d.getDate(),
        label: wd.format(d),
        monthStart,
        today: key === today,
        off: off.has(d.getDay()),
        holiday: hol.get(key) ?? null,
      });
    }
    return out;
  });

  /** Consecutive months across the window (label carries the year once it differs from today's). */
  readonly months = $derived.by<TimelineMonth[]>(() => {
    const thisYear = String(new Date().getFullYear());
    const out: TimelineMonth[] = [];
    for (const d of this.days) {
      const key = d.key.slice(0, 7);
      const last = out.at(-1);
      if (last && last.key === key) last.days++;
      else {
        const date = new Date(`${d.key}T00:00:00`);
        const opts: Intl.DateTimeFormatOptions =
          key.slice(0, 4) === thisYear ? { month: 'short' } : { month: 'short', year: 'numeric' };
        out.push({ key, label: new Intl.DateTimeFormat(this.locale, opts).format(date), days: 1 });
      }
    }
    return out;
  });

  /** `${resourceId}:${day}` → that day's bookings, by start time. */
  readonly #bookingsByDay = $derived.by(() => {
    const m = new Map<string, TeamBooking[]>();
    for (const b of Object.values(this.#bookings)) {
      const k = `${b.resourceId}:${localKey(b.start)}`;
      const list = m.get(k) ?? [];
      list.push(b);
      m.set(k, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  });

  /** `${employeeId}:${day}` → leave bar segment (pending + approved only). */
  readonly #leaveByDay = $derived.by(() => {
    const m = new Map<string, LeaveMark>();
    for (const l of this.leaves) {
      if (l.status !== 'pending' && l.status !== 'approved') continue;
      for (let k = l.fromDate; k <= l.toDate; k = addDays(k, 1))
        m.set(`${l.employeeId}:${k}`, {
          request: l,
          status: l.status,
          first: k === l.fromDate,
          last: k === l.toDate,
        });
    }
    return m;
  });

  bookingsAt(resourceId: string | null, day: string): TeamBooking[] {
    return resourceId ? (this.#bookingsByDay.get(`${resourceId}:${day}`) ?? EMPTY) : EMPTY;
  }
  leaveAt(employeeId: string, day: string): LeaveMark | undefined {
    return this.#leaveByDay.get(`${employeeId}:${day}`);
  }

  /** Called by the header cell once mounted: own the scroller, centre today, load the window. */
  attach(el: HTMLDivElement) {
    this.#el = el;
    this.centerToday();
    void this.#load(this.start, this.end);
  }
  centerToday() {
    const el = this.#el;
    if (!el) return;
    const idx = this.days.findIndex((d) => d.today);
    el.scrollLeft = Math.max(0, idx * DAY_PX - (el.clientWidth - DAY_PX) / 2);
    this.offset = el.scrollLeft;
  }
  onScroll() {
    const el = this.#el;
    if (!el) return;
    this.offset = el.scrollLeft;
    const edge = EDGE * DAY_PX;
    if (el.scrollLeft < edge) void this.#extend(-1);
    else if (el.scrollWidth - el.clientWidth - el.scrollLeft < edge) void this.#extend(1);
  }
  /** Horizontal wheel/trackpad gestures over any row drive the shared scroller. */
  wheel(e: WheelEvent) {
    const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
    if (!dx || !this.#el) return;
    e.preventDefault();
    this.#el.scrollLeft += dx;
  }

  // TODO(handoff): leave bars + holiday shading come from the loader's current-year
  // props; extending into another year fetches bookings only. Fetch
  // /api/scheduling/hr/leave-requests?from&to and /holidays?from&to here too
  // (proposal 2026-09-03-hub-team-hr-tabs-followups #11).
  async #extend(dir: -1 | 1) {
    if (this.#extending || !this.#el) return;
    this.#extending = true;
    try {
      if (dir < 0) {
        const from = addDays(this.start, -STEP);
        this.start = from;
        this.count += STEP;
        await tick();
        this.#el.scrollLeft += STEP * DAY_PX;
        this.offset = this.#el.scrollLeft;
        await this.#load(from, addDays(this.#loadedFrom, -1));
      } else {
        const prevEnd = this.end;
        this.count += STEP;
        await this.#load(addDays(prevEnd, 1), this.end);
      }
    } finally {
      this.#extending = false;
    }
  }

  async #load(from: string, to: string) {
    if (to < from) return;
    const q = new URLSearchParams({ from, to, status: 'accepted,pending,completed' });
    try {
      const { bookings } = await fetchJson<{
        bookings: {
          id: string;
          resourceId: string;
          eventTypeId: string;
          startTime: string;
          endTime: string;
          status: string;
          attendeeName: string | null;
        }[];
      }>(`/api/scheduling/bookings?${q}`);
      for (const b of bookings)
        this.#bookings[b.id] = {
          id: b.id,
          resourceId: b.resourceId,
          eventTypeId: b.eventTypeId,
          start: b.startTime,
          end: b.endTime,
          status: b.status,
          attendeeName: b.attendeeName,
        };
      this.#loadedFrom = this.#loadedFrom && this.#loadedFrom < from ? this.#loadedFrom : from;
      this.#loadedTo = this.#loadedTo > to ? this.#loadedTo : to;
    } catch {
      // ponytail: a failed page of bookings leaves those days empty; the next scroll retries.
    }
  }
}
