/**
 * The pure half of CompositionEditor (spec 2026-10-10 catalog-service-
 * unification, Slice 2): which catalog entries a parent may contain, and which
 * table a (parent kind, child kind) pair is stored in. Kept DOM-free so the
 * invariant is checkable without a component mount.
 */
export type Kind = 'service' | 'product';
export type WritePath = 'package' | 'consumption' | 'bom';

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
  parent: { productId: string; kind: Kind; itemId: string | null },
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
  // A product composes through its stock item's BOM; without one there is no
  // node to hang children off.
  const productChildrenAllowed =
    opts.stockEnabled && (parent.kind === 'service' || !!parent.itemId);
  if (productChildrenAllowed)
    for (const i of items) {
      if (i.id === parent.itemId) continue;
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

/** Storage is unchanged; only the write path is chosen here. */
export function writePathFor(parentKind: Kind, childKind: Kind): WritePath {
  if (childKind === 'service') return 'package';
  return parentKind === 'service' ? 'consumption' : 'bom';
}
