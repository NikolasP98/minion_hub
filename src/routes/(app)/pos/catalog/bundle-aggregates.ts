/**
 * A bundle row (`kind: 'bundle'`, `fin_product_components` edges) carries no
 * `stk_consumption` of its own, so `costForProducts` / `applyRecipeAvailability`
 * leave it `—` for Stock/Cost/Margin. This derives those from the bundle's
 * children instead — pure, over the catalog's own enriched rows (matched by
 * id), no extra DB round trip beyond the already-loaded bundle edges.
 *
 * shortcut: one level of nesting (a child that is itself a bundle keeps `—`),
 * upgrade when a bundle sells a bundle.
 */
export interface AggregateRow {
  productId: string;
  kind: 'product' | 'service' | 'bundle';
  unitPrice: number | null;
  stockQty: number | null;
  cost: number | null;
  margin: number | null;
  marginPct: number | null;
  costable: boolean;
  partial: boolean;
}

export interface BundleEdgeLike {
  bundleProductId: string;
  childProductId: string;
  qty: number;
}

export function aggregateBundles<T extends AggregateRow>(
  rows: T[],
  edges: BundleEdgeLike[],
): T[] {
  const byId = new Map(rows.map((r) => [r.productId, r]));
  const edgesByBundle = new Map<string, BundleEdgeLike[]>();
  for (const e of edges) {
    const list = edgesByBundle.get(e.bundleProductId);
    if (list) list.push(e);
    else edgesByBundle.set(e.bundleProductId, [e]);
  }

  return rows.map((row) => {
    if (row.kind !== 'bundle') return row;
    const children = edgesByBundle.get(row.productId);
    if (!children || children.length === 0) return row;

    // One level only: a child that is itself a bundle has no resolved
    // stock/cost here, so it can't contribute to its parent's aggregate.
    const resolved = children.map((edge) => ({ edge, child: byId.get(edge.childProductId) }));
    const costResolved = resolved.every(
      ({ child }) => child && child.kind !== 'bundle' && child.cost != null,
    );
    const stockResolved = resolved.every(
      ({ child }) => child && child.kind !== 'bundle' && child.stockQty != null,
    );

    const cost = costResolved
      ? Math.round(resolved.reduce((sum, { edge, child }) => sum + child!.cost! * edge.qty, 0) * 100) /
        100
      : null;
    const stockQty = stockResolved
      ? Math.min(...resolved.map(({ edge, child }) => Math.floor(child!.stockQty! / edge.qty)))
      : null;

    if (cost == null) return stockQty === row.stockQty ? row : { ...row, stockQty };

    const margin = row.unitPrice != null ? Math.round((row.unitPrice - cost) * 100) / 100 : null;
    const marginPct =
      margin != null && row.unitPrice ? Math.round((margin / row.unitPrice) * 1000) / 10 : null;

    return { ...row, cost, margin, marginPct, stockQty, costable: true, partial: false };
  });
}
