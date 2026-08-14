import { requireOrgCapability } from '$server/services/rbac.service';
import type { PermAction } from '$server/services/rbac.service';

/**
 * A "sellable" is not a pos-owned row. It is a `fin_products` record (finance)
 * optionally joined to a `stk_items` record and `stk_consumption` recipe rows
 * (stock) — see createSellable/updateSellable in pos.service.ts. But the
 * central guard (`apiWriteCapability`) resolves the required capability from
 * the URL PREFIX, so every write here bought itself with `pos:*` alone:
 * `pos:edit` was enough to rename `fin_products.code`, the business key the
 * SUSII/invoice sync resolves invoice lines through.
 *
 * So the pos capability (already enforced centrally) is necessary but not
 * sufficient — this adds the OWNING module's capability on top, and only for
 * the fields the request actually carries. A front-desk role with pos:edit and
 * nothing else can still do pos-owned work; it just can't rewrite the finance
 * catalog or stock recipes through the pos door.
 */
const FINANCE_FIELDS = ['name', 'code', 'category', 'unitPrice', 'active'] as const;
const STOCK_FIELDS = ['consumption', 'itemId', 'trackStock', 'uom'] as const;

const touches = (body: object, fields: readonly string[]): boolean =>
  fields.some((f) => f in body);

export async function requireSellableFieldCapabilities(
  locals: App.Locals,
  body: object,
  action: PermAction,
): Promise<void> {
  if (touches(body, FINANCE_FIELDS)) await requireOrgCapability(locals, 'finance', action);
  if (touches(body, STOCK_FIELDS)) await requireOrgCapability(locals, 'stock', action);
}
