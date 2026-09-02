/**
 * The scheduler's "Services" view is the catalog's service-kind sellables,
 * each flagged by whether it has scheduling data (an event type linked via
 * `productId`). Event types not linked to any catalog service still render so
 * legacy rows never vanish from the list.
 */
export interface CatalogService {
  id: string;
  name: string;
}

export interface ServiceRow<E extends { id: string; productId: string | null }> {
  key: string;
  title: string;
  service: CatalogService | null;
  eventType: E | null;
}

export function buildServiceRows<E extends { id: string; title: string; productId: string | null }>(
  services: CatalogService[],
  eventTypes: E[],
): ServiceRow<E>[] {
  const byProduct = new Map(eventTypes.filter((e) => e.productId).map((e) => [e.productId!, e]));
  const linked = new Set<string>();
  const rows: ServiceRow<E>[] = services.map((s) => {
    const et = byProduct.get(s.id) ?? null;
    if (et) linked.add(et.id);
    return { key: s.id, title: s.name, service: s, eventType: et };
  });
  for (const et of eventTypes) {
    if (!linked.has(et.id))
      rows.push({ key: et.id, title: et.title, service: null, eventType: et });
  }
  // Configured first (the ones a front desk can book), dormant after; stable
  // alphabetical within each group.
  return rows.sort(
    (a, b) => Number(!!b.eventType) - Number(!!a.eventType) || a.title.localeCompare(b.title),
  );
}
