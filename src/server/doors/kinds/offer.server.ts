import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finProducts, finSettings } from '$server/db/pg-finance-schema';
import { schedLinks } from '$server/db/pg-scheduling-schema';
import { isModuleEnabled } from '$server/services/modules.service';
import { configSchema, whatsappDigits } from '$lib/doors/kinds/offer';
import type { DoorRow, PublicDoorData } from '$lib/doors/types';

export const kind = 'offer' as const;

/**
 * Public projection: name, category, live price, currency, a bare wa.me URL
 * and the booking slug. Never cost, stock, SKU/code or any id. Rows are read
 * inside `withOrgCore` (forced RLS) AND filtered by org, so a foreign product
 * id in the config yields nothing.
 */
export async function publicView(ctx: CoreCtx, door: DoorRow): Promise<PublicDoorData> {
  const cfg = configSchema.safeParse(door.config);
  if (!cfg.success) return { items: [], currency: 'PEN', waUrl: null, bookingSlug: null };
  const { productIds, whatsappNumber } = cfg.data;
  // /book/<slug> 404s while scheduling is off, so the button must not show either.
  const bookingLinkId =
    cfg.data.bookingLinkId && (await isModuleEnabled(ctx, 'scheduling'))
      ? cfg.data.bookingLinkId
      : null;

  const { products, settings, link } = await withOrgCore(ctx, async (tx) => {
    const products = productIds.length
      ? await tx
          .select({
            id: finProducts.id,
            name: finProducts.name,
            category: finProducts.category,
            unitPrice: finProducts.unitPrice,
          })
          .from(finProducts)
          .where(
            and(
              eq(finProducts.orgId, ctx.tenantId),
              eq(finProducts.active, true),
              inArray(finProducts.id, productIds),
            ),
          )
      : [];
    const [settings] = await tx
      .select({ currency: finSettings.currency })
      .from(finSettings)
      .where(eq(finSettings.orgId, ctx.tenantId))
      .limit(1);
    const [link] = bookingLinkId
      ? await tx
          .select({ slug: schedLinks.slug })
          .from(schedLinks)
          .where(
            and(
              eq(schedLinks.id, bookingLinkId),
              eq(schedLinks.orgId, ctx.tenantId),
              eq(schedLinks.active, true),
              or(isNull(schedLinks.expiresAt), gt(schedLinks.expiresAt, new Date())),
            ),
          )
          .limit(1)
      : [];
    return { products, settings, link };
  });

  const byId = new Map(products.map((p) => [p.id, p]));
  const items = productIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      name: p.name,
      category: p.category,
      price: p.unitPrice == null ? null : Number(p.unitPrice),
    }));
  const digits = whatsappDigits(whatsappNumber);
  return {
    items,
    currency: settings?.currency ?? 'PEN',
    waUrl: digits ? `https://wa.me/${digits}` : null,
    bookingSlug: link?.slug ?? null,
  };
}
