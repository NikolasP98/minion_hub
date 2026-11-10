import { error } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getFinSettings } from './finance.service';
import { parseAssistantPeriod } from './assistant-period';
import { listEventTypes, listResources } from './scheduling.service';
import { getSlotsForEventType } from './scheduling-slots.service';

export interface AssistantBookingOptions {
  query?: string;
  eventTypeId?: string;
  resourceId?: string;
  date?: string;
  limit: number;
}
const coverage = (total: number, returned: number) => ({
  total,
  returned,
  truncated: total > returned,
});

/** Typed reference discovery; never grants creation authority or reserves a slot. */
export async function assistantBookingOptions(ctx: CoreCtx, options: AssistantBookingOptions) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)
    throw error(400, 'limit: expected integer 1..100');
  if ((options.query?.length ?? 0) > 200) throw error(400, 'query: maximum 200 characters');
  for (const [key, value] of [
    ['eventTypeId', options.eventTypeId],
    ['resourceId', options.resourceId],
    ['date', options.date],
  ])
    if (value !== undefined && (!value.trim() || value.length > 200))
      throw error(400, `${key}: invalid value`);
  if (options.date && !options.eventTypeId) throw error(400, 'date requires eventTypeId');
  const { timezone } = await getFinSettings(ctx);
  const window = options.date
    ? parseAssistantPeriod(
        new URL(
          'https://scope.invalid/?from=' +
            encodeURIComponent(options.date) +
            '&to=' +
            encodeURIComponent(options.date),
        ),
        timezone,
      ).period
    : null;
  const [allTypes, allResources] = await Promise.all([listEventTypes(ctx), listResources(ctx)]);
  const resources = allResources.filter((r) => r.active && r.orgId === ctx.tenantId);
  const resourceIds = new Set(resources.map((r) => r.id));
  if (options.resourceId && !resourceIds.has(options.resourceId))
    throw error(404, 'Booking resource unavailable');
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const types = allTypes.filter(
    (t) =>
      t.active &&
      t.orgId === ctx.tenantId &&
      (!options.eventTypeId || t.id === options.eventTypeId) &&
      (!query || t.title.toLocaleLowerCase().includes(query)) &&
      (!options.resourceId || t.resourceIds.includes(options.resourceId)),
  );
  if (options.eventTypeId && !types.length) throw error(404, 'Booking service unavailable');
  const selectedTypes = types.slice(0, options.limit);
  const eligible = new Set(
    selectedTypes.flatMap((t) => t.resourceIds).filter((id) => resourceIds.has(id)),
  );
  const matchingResources = resources.filter(
    (r) => eligible.has(r.id) && (!options.resourceId || r.id === options.resourceId),
  );
  const selectedResources = matchingResources.slice(0, options.limit);
  const returnedResources = new Set(selectedResources.map((r) => r.id));
  const slotResult =
    window && options.eventTypeId
      ? await getSlotsForEventType(
          ctx,
          options.eventTypeId,
          new Date(window.from!),
          new Date(window.to!),
          {
            pinnedResourceId: options.resourceId,
          },
        )
      : null;
  if (window && !slotResult) throw error(404, 'Booking service unavailable');
  const availableSlots = (slotResult?.slots ?? [])
    .filter(
      (s) =>
        s.start.getTime() >= new Date(window!.from!).getTime() &&
        s.end.getTime() <= new Date(window!.to!).getTime(),
    )
    .map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      resourceIds: s.resourceIds.filter((id) => returnedResources.has(id)),
    }))
    .filter((s) => s.resourceIds.length > 0);
  return {
    eventTypes: selectedTypes.map((t) => ({
      eventTypeId: t.id,
      productId: t.productId,
      title: t.title,
      lengthMinutes: t.length,
      price: t.price,
      currency: t.currency,
      resourceIds: t.resourceIds.filter((id) => returnedResources.has(id)),
    })),
    resources: selectedResources.map((r) => ({
      resourceId: r.id,
      name: r.name,
      timezone: r.timezone,
    })),
    slots: availableSlots.slice(0, options.limit),
    timezone,
    date: options.date ?? null,
    availability: 'at_read_not_reserved',
    coverage: {
      eventTypes: coverage(types.length, selectedTypes.length),
      resources: coverage(matchingResources.length, selectedResources.length),
      slots: coverage(availableSlots.length, Math.min(availableSlots.length, options.limit)),
      slotsRestrictedToReturnedResources: true,
    },
  };
}
