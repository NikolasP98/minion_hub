/**
 * Roster timeline state — ONE horizontal scroll owner (the header cell) shared
 * by every row of the People table. Rows mirror `offset` with a translate, so
 * day columns line up under a single set of day headers. The window is ±45
 * days around today and grows by 30 days when the header scrolls within 7
 * days of an edge (bookings for the new span are fetched on demand).
 */
import { tick } from 'svelte';
import { fetchJson } from '$lib/api/fetch-json';
import {
  checkedZonedDayWindow,
  dateKeyAddDays,
  dateKeyWeekday,
  instantDateKey,
  parseDateKey,
} from '$lib/time/zoned';
import { hrErrorMessage } from './hr-error';
import type { LeaveStatus, TeamBooking, TeamHoliday, TeamLeaveRequest } from './types';

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
  const shifted = dateKeyAddDays(key, n);
  if (!shifted) throw new RangeError('invalid timeline date');
  return shifted;
}

const dateCarrier = (key: string): Date => {
  const date = parseDateKey(key);
  if (!date) throw new RangeError('invalid timeline date');
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
};

const EMPTY: TeamBooking[] = [];

export class Timeline {
  timeZone = $state('');
  start = $state('');
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
  loading = $state(0);
  errors = $state<Array<{ from: string; to: string; message: string }>>([]);
  #requests = new Map<string, AbortController>();
  #generation = 0;
  #scope = '';
  #source: TeamBooking[] | undefined;
  #el: HTMLDivElement | null = null;
  #extending = false;

  constructor(timeZone: string) {
    this.timeZone = timeZone;
    this.start = addDays(instantDateKey(new Date(), timeZone), -PAD);
  }

  readonly end = $derived(addDays(this.start, this.count - 1));

  readonly days = $derived.by<TimelineDay[]>(() => {
    const today = instantDateKey(new Date(), this.timeZone);
    const off = new Set(this.weeklyOff);
    const hol = new Map(this.holidays.filter((h) => h.enabled).map((h) => [h.date, h.name]));
    const wd = new Intl.DateTimeFormat(this.locale, { weekday: 'short', timeZone: 'UTC' });
    const out: TimelineDay[] = [];
    for (let i = 0; i < this.count; i++) {
      const key = addDays(this.start, i);
      const date = parseDateKey(key)!;
      const weekday = dateKeyWeekday(key)!;
      out.push({
        key,
        num: date.day,
        label: wd.format(dateCarrier(key)),
        monthStart: date.day === 1,
        today: key === today,
        off: off.has(weekday),
        holiday: hol.get(key) ?? null,
      });
    }
    return out;
  });

  /** Consecutive months across the window (label carries the year once it differs from today's). */
  readonly months = $derived.by<TimelineMonth[]>(() => {
    const thisYear = instantDateKey(new Date(), this.timeZone).slice(0, 4);
    const out: TimelineMonth[] = [];
    for (const d of this.days) {
      const key = d.key.slice(0, 7);
      const last = out.at(-1);
      if (last && last.key === key) last.days++;
      else {
        const opts: Intl.DateTimeFormatOptions =
          key.slice(0, 4) === thisYear
            ? { month: 'short', timeZone: 'UTC' }
            : { month: 'short', year: 'numeric', timeZone: 'UTC' };
        out.push({
          key,
          label: new Intl.DateTimeFormat(this.locale, opts).format(dateCarrier(d.key)),
          days: 1,
        });
      }
    }
    return out;
  });

  /** `${resourceId}:${day}` → that day's bookings, by start time. */
  readonly #bookingsByDay = $derived.by(() => {
    const m = new Map<string, TeamBooking[]>();
    for (const b of Object.values(this.#bookings)) {
      const k = `${b.resourceId}:${instantDateKey(new Date(b.start), this.timeZone)}`;
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
    return () => {
      if (this.#el !== el) return;
      this.#el = null;
      this.#resetRequests();
    };
  }

  /** SSR refreshes and organization changes invalidate every older network reply. */
  replaceSource(scope: string, source: TeamBooking[], timeZone: string) {
    const zoneChanged = timeZone !== this.timeZone;
    if (scope === this.#scope && source === this.#source && !zoneChanged) return;
    this.#resetRequests();
    this.timeZone = timeZone;
    if (scope !== this.#scope || zoneChanged) {
      this.start = addDays(instantDateKey(new Date(), timeZone), -PAD);
      this.count = PAD * 2 + 1;
      const generation = this.#generation;
      void tick().then(() => {
        if (generation === this.#generation) this.centerToday();
      });
    }
    this.#scope = scope;
    this.#source = source;
    this.#bookings = Object.fromEntries(source.map((booking) => [booking.id, booking]));
    this.errors = [];
    if (this.#el) void this.#load(this.start, this.end);
  }

  #resetRequests() {
    this.#generation++;
    for (const controller of this.#requests.values()) controller.abort();
    this.#requests.clear();
    this.loading = 0;
    this.#extending = false;
  }

  async retry() {
    // Each failure retains its own missing interval, including a failed first load.
    const generation = this.#generation;
    for (const range of [...this.errors]) {
      if (generation !== this.#generation) return;
      await this.#load(range.from, range.to);
      if (generation !== this.#generation) return;
    }
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
    const generation = this.#generation;
    try {
      if (dir < 0) {
        const previousStart = this.start;
        const from = addDays(previousStart, -STEP);
        this.start = from;
        this.count += STEP;
        await tick();
        if (generation !== this.#generation || !this.#el) return;
        this.#el.scrollLeft += STEP * DAY_PX;
        this.offset = this.#el.scrollLeft;
        await this.#load(from, addDays(previousStart, -1));
      } else {
        const prevEnd = this.end;
        this.count += STEP;
        await this.#load(addDays(prevEnd, 1), this.end);
      }
    } finally {
      if (generation === this.#generation) this.#extending = false;
    }
  }

  #clearRange(from: string, to: string) {
    for (const [id, booking] of Object.entries(this.#bookings)) {
      const day = instantDateKey(new Date(booking.start), this.timeZone);
      if (day >= from && day <= to) delete this.#bookings[id];
    }
  }

  async #load(from: string, to: string) {
    if (to < from) return;
    const key = `${from}:${to}`;
    if (this.#requests.has(key)) return;
    const instantWindow = checkedZonedDayWindow(from, to, this.timeZone);
    if (!instantWindow.ok || !instantWindow.from || !instantWindow.to) {
      const message = instantWindow.ok ? 'invalid calendar window' : instantWindow.reason;
      this.errors = [
        ...this.errors.filter((range) => range.from !== from || range.to !== to),
        { from, to, message },
      ];
      return;
    }
    const controller = new AbortController();
    const generation = this.#generation;
    this.#requests.set(key, controller);
    this.loading++;
    const current = () => generation === this.#generation && this.#requests.get(key) === controller;
    // The bookings endpoint accepts instants. Resolve the visible organization
    // date keys here so a browser in another timezone cannot widen or shift the
    // Team timeline's lazy-loaded window.
    const q = new URLSearchParams({
      from: instantWindow.from.toISOString(),
      to: new Date(instantWindow.to.getTime() - 1).toISOString(),
      status: 'accepted,pending,completed',
    });
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
      }>(`/api/scheduling/bookings?${q}`, { signal: controller.signal });
      if (!current()) return;
      this.#clearRange(from, to);
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
      this.errors = this.errors.filter((range) => range.from !== from || range.to !== to);
    } catch (cause) {
      if (!current()) return;
      this.#clearRange(from, to);
      this.errors = [
        ...this.errors.filter((range) => range.from !== from || range.to !== to),
        { from, to, message: hrErrorMessage(cause) },
      ];
    } finally {
      if (current()) {
        this.#requests.delete(key);
        this.loading--;
      }
    }
  }
}
