/**
 * `BookingCalendar`'s feature switches.
 *
 * The grid is ONE component serving every calendar surface in the hub, so the
 * behaviours a surface does not want are switched off rather than forked. Every
 * default is what `/pos/appointments` — the surface the grid grew up on — does
 * today, so a caller that passes nothing keeps that behaviour exactly.
 *
 * `agenda` is the one default-OFF flag: it adds a view to the switcher, so a
 * surface has to ask for it.
 */

export const CALENDAR_FEATURE_DEFAULTS = {
  /** Clicking a container visit spreads its procedures into a side deck.
   *  Off ⇒ a container click opens its lead booking through `onopen`. */
  fanOut: true,
  /** Dropping a booking onto a compatible visit offers to merge the two.
   *  Off ⇒ every drop is a plain move (no merge outline, ghost or dialog). */
  merge: true,
  /** Press-and-drag on empty grid space spans a new booking's window. */
  createDrag: true,
  /** Double-click (or Enter) on empty grid space opens the create form. */
  createDblClick: true,
  /** The current-time rule. */
  nowLine: true,
  /** Shading outside the resources' working hours (needs `hours`). */
  offHours: true,
  /** The toolbar kebab. Off ⇒ no per-viewer calendar options at all. */
  kebab: true,
  /** The block/sliver colour-source pickers inside the kebab (needs `oncolorby`). */
  colorPicker: true,
  /** The event-block + hover-card field lists inside the kebab. */
  fieldsMenu: true,
  /** The "days per screen" stepper inside the kebab (needs `onweekdays`). */
  weekDaysStepper: true,
  /** The "Invoiced | Scheduled" split (needs `invoices`). */
  split: true,
  /** The mini month picker behind the range label. Off ⇒ the label is inert text. */
  datePicker: true,
  /** The `agenda` view — a day-grouped list — and its switcher entry. */
  agenda: false,
} as const;

export type CalendarFeature = keyof typeof CALENDAR_FEATURE_DEFAULTS;
export type CalendarFeatures = Record<CalendarFeature, boolean>;

/**
 * Fill a partial flag set from the defaults. An explicitly `undefined` entry
 * means "not stated" and keeps the default — spreading alone would overwrite it
 * with `undefined`, which reads as `false` at every call site.
 */
export function resolveFeatures(partial?: Partial<CalendarFeatures>): CalendarFeatures {
  const out: CalendarFeatures = { ...CALENDAR_FEATURE_DEFAULTS };
  if (!partial) return out;
  for (const key of Object.keys(CALENDAR_FEATURE_DEFAULTS) as CalendarFeature[]) {
    const value = partial[key];
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}
