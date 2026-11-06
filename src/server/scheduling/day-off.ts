import type { ResourceAvailability } from './slots';

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
