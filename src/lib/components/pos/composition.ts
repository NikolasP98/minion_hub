/**
 * The pure half of CompositionEditor (spec 2026-10-10 catalog-service-
 * unification, Slice 2): which catalog entries a parent may contain, and which
 * table a (parent kind, child kind) pair is stored in. Kept DOM-free so the
 * invariant is checkable without a component mount.
 */
export type Kind = 'service' | 'product';
export type WritePath = 'package' | 'consumption';

export interface SellableLike {
  productId: string;
  code: string;
  name: string;
  unitPrice: number | null;
  kind: 'product' | 'service' | 'bundle';
  active: boolean;
}
export interface ItemLike {
  id: string;
  code: string;
  name: string;
  uom: string;
}
export interface Candidate {
  id: string;
  kind: Kind;
  code: string;
  name: string;
  detail: string;
  ref: string;
}

/** Invariant I2: a service may contain services and products; a product, products only.
 *  A package may not contain a package (the server's one-level cycle guard). */
export function candidatesFor(
  parent: { productId: string; kind: Kind },
  sellables: SellableLike[],
  items: ItemLike[],
  opts: { stockEnabled: boolean; formatMoney: (n: number) => string },
): Candidate[] {
  const out: Candidate[] = [];
  if (parent.kind === 'service')
    for (const s of sellables) {
      if (!s.active || s.productId === parent.productId || s.kind !== 'service') continue;
      out.push({
        id: `p:${s.productId}`,
        kind: 'service',
        code: s.code,
        name: s.name,
        detail: s.unitPrice != null ? opts.formatMoney(s.unitPrice) : '',
        ref: s.productId,
      });
    }
  // Every entry composes stock items through its recipe (meta spec 024).
  if (opts.stockEnabled)
    for (const i of items) {
      out.push({
        id: `i:${i.id}`,
        kind: 'product',
        code: i.code,
        name: i.name,
        detail: i.uom,
        ref: i.id,
      });
    }
  return out;
}

/** Service child → package edges; stock-item child → the recipe, whatever the parent. */
export function writePathFor(childKind: Kind): WritePath {
  return childKind === 'service' ? 'package' : 'consumption';
}

/**
 * Owner rule 2026-10-12: a PACKAGE never re-declares the consumption of a
 * service it includes. Including "Afinamiento Facial (individual)" (which
 * consumes 6 ml of Acido Desoxicolico) in "Afinamiento de Rostro (completo)"
 * must not copy that 6 ml onto the pack: nothing is delivered when the pack is
 * sold — the sale mints session grants, and the insumo is issued later, through
 * the base service, when a session is actually booked/completed. A pack's own
 * consumption is only what it hands over at the counter.
 *
 * TODO(handoff): a pack's PRODUCT lines are issued at sale (handed over at the
 * counter). "6 ml deposited to the client's account, drawn down over visits"
 * would need a product-shaped grant — `posPackageGrants.serviceProductId` is
 * service-only today. See meta
 * proposals/2026-10-12-hub-pos-package-semantics.md open end 2.
 *
 * Returns the item ids a write may NOT introduce. `added` is the items NOT
 * already stored, so a pack that already carries a duplicate (pre-rule data)
 * stays editable instead of 409-ing on every save — `scripts/clean-package-
 * duplicate-consumption.ts` removes those.
 */
export function blockedPackageConsumption(
  added: { itemId: string }[],
  consumedByIncludedServices: Iterable<string>,
): string[] {
  const owned = new Set(consumedByIncludedServices);
  return [...new Set(added.map((c) => c.itemId).filter((id) => owned.has(id)))];
}

/** What the catalog's Composición column needs — all of it already on the row. */
export interface CompositionFacts {
  kind: 'product' | 'service' | 'bundle';
  /** Σ sessions over the pack's service edges (`fin_product_components.qty`). */
  packageSessions: number;
  /** Names of the items this entry's OWN `stk_consumption` consumes. */
  consumedItemNames: string[];
}

export interface CompositionLabels {
  /** "Paquete" / "Bundle". */
  pkg: string;
  sessions: (count: number) => string;
  products: (count: number) => string;
  insumos: (count: number) => string;
}

/**
 * One line that says what an entry is MADE OF — replaces the green
 * "has consumption" dot, which told the owner nothing ("this insumos column
 * makes NO sense to me").
 *
 * A single insumo shows its name rather than "1 insumos": the name is the
 * information, and it is already on the row.
 */
export function compositionSummary(f: CompositionFacts, l: CompositionLabels): string {
  const products = f.consumedItemNames.length;
  if (f.kind === 'bundle') {
    const parts: string[] = [];
    if (f.packageSessions > 0) parts.push(l.sessions(f.packageSessions));
    if (products > 0) parts.push(l.products(products));
    return parts.length ? `${l.pkg} · ${parts.join(' + ')}` : l.pkg;
  }
  if (products === 1) return f.consumedItemNames[0];
  if (products > 1) return l.insumos(products);
  return '—';
}
