import type { ResourceAvailability } from './slots';

/**
 * HR days off must replace dated working hours, not just weekly hours: the slot
 * engine combines dated rules and skips empty intervals, so appending an empty
 * rule alone would leave a competing working interval bookable. Other dates
 * retain their overrides. Regression: scheduling-bookings.assistant.test.ts.
 */
export function applyDayOffOverrides(
  availability: ResourceAvailability[],
  dayOff: ReadonlyMap<string, readonly string[]>,
): void {
  for (const resource of availability) {
    const dates = new Set(dayOff.get(resource.resourceId) ?? []);
    resource.rules = resource.rules.filter((rule) => !rule.date || !dates.has(rule.date));
    for (const date of dates)
      resource.rules.push({ days: [], startTime: '00:00', endTime: '00:00', date });
  }
}
