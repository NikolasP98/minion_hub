import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  CUSTOM_PROPERTY_TABLE_IDS,
  type CustomPropertyRecordAccess,
  type CustomPropertyTableId,
} from '$lib/tables/custom-properties';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { crmContacts } from '$server/db/pg-crm-schema';
import { finInvoices, finProducts, finPurchases } from '$server/db/pg-finance-schema';
import { hrEmployees } from '$server/db/pg-hr-schema';
import { metaAdInsights, metaAssets, metaConnections } from '$server/db/pg-meta-schema';
import { stkEntries, stkItems } from '$server/db/pg-schema/stock';
import { schedBookings } from '$server/db/pg-scheduling-schema';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  hasOrgCapability,
  ownerFilter,
  shouldMaskSensitive,
  type Module,
} from '$server/services/rbac.service';
import { listUsers } from '$server/services/user.service';

export type CustomPropertyRecordAction = 'view' | 'edit';

const TABLE_MODULE: Record<
  Exclude<CustomPropertyTableId, 'team.people'>,
  { module: Module; moduleId: string }
> = {
  'stock.items': { module: 'stock', moduleId: 'stock' },
  'stock.entries': { module: 'stock', moduleId: 'stock' },
  'pos.catalog': { module: 'pos', moduleId: 'pos' },
  'crm.customers': { module: 'crm', moduleId: 'crm' },
  'finances.invoices': { module: 'finance', moduleId: 'finances' },
  'finances.purchases': { module: 'finance', moduleId: 'finances' },
  'socials.campaigns': { module: 'ads', moduleId: 'socials' },
  'scheduling.bookings': { module: 'scheduling', moduleId: 'scheduling' },
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECORD_IDS = 500;

function uniqueRecordIds(recordIds: readonly string[]): string[] {
  if (recordIds.length > MAX_RECORD_IDS) return [];
  return [...new Set(recordIds.filter((id) => id.length > 0 && id.length <= 200))];
}

async function moduleAccess(
  locals: App.Locals,
  ctx: CoreCtx,
  module: Module,
  moduleId: string,
  action: CustomPropertyRecordAction,
): Promise<{ allowed: boolean; canEdit: boolean }> {
  const [enabled, canView, canEdit] = await Promise.all([
    isModuleEnabled(ctx, moduleId),
    hasOrgCapability(locals, module, 'view'),
    hasOrgCapability(locals, module, 'edit'),
  ]);
  return {
    allowed: enabled && canView && (action === 'view' || canEdit),
    canEdit: enabled && canView && canEdit,
  };
}

function accessFor(
  ids: readonly string[],
  canEdit: boolean,
): Record<string, CustomPropertyRecordAccess> {
  return Object.fromEntries(ids.map((id) => [id, { canEdit }]));
}

async function authorizeTeamRecords(
  locals: App.Locals,
  ctx: CoreCtx,
  recordIds: readonly string[],
  action: CustomPropertyRecordAction,
): Promise<Record<string, CustomPropertyRecordAccess>> {
  const [enabled, schedulingView, schedulingEdit, usersView, usersEdit, masked] = await Promise.all(
    [
      isModuleEnabled(ctx, 'scheduling'),
      hasOrgCapability(locals, 'scheduling', 'view'),
      hasOrgCapability(locals, 'scheduling', 'edit'),
      hasOrgCapability(locals, 'users', 'view'),
      hasOrgCapability(locals, 'users', 'edit'),
      shouldMaskSensitive(locals, 'scheduling'),
    ],
  );
  if (!enabled || !schedulingView || masked) return {};

  const employeeIds = recordIds.filter((id) => UUID_RE.test(id));
  const memberIds = recordIds
    .filter((id) => id.startsWith('member:') && UUID_RE.test(id.slice('member:'.length)))
    .map((id) => id.slice('member:'.length));

  const [employees, members] = await Promise.all([
    employeeIds.length
      ? withOrgCore(ctx, (tx) =>
          tx
            .select({ id: hrEmployees.id })
            .from(hrEmployees)
            .where(and(eq(hrEmployees.orgId, ctx.tenantId), inArray(hrEmployees.id, employeeIds))),
        )
      : Promise.resolve([]),
    memberIds.length && usersView ? listUsers(ctx) : Promise.resolve([]),
  ]);

  const result: Record<string, CustomPropertyRecordAccess> = {};
  if (action === 'view' || schedulingEdit) {
    for (const row of employees) result[row.id] = { canEdit: schedulingEdit };
  }
  if (usersView && (action === 'view' || usersEdit)) {
    const requested = new Set(memberIds);
    for (const member of members) {
      if (member.accountType !== 'service' && requested.has(member.id)) {
        result[`member:${member.id}`] = { canEdit: usersEdit };
      }
    }
  }
  return result;
}

/**
 * Resolve browser-provided record IDs through the owning domain's authoritative
 * organization and permission boundary. Missing, foreign and malformed IDs are
 * all omitted so callers cannot use this seam as an existence oracle.
 */
export async function authorizeCustomPropertyRecords(
  locals: App.Locals,
  ctx: CoreCtx,
  tableId: string,
  recordIds: readonly string[],
  action: CustomPropertyRecordAction,
): Promise<Record<string, CustomPropertyRecordAccess>> {
  const ids = uniqueRecordIds(recordIds);
  if (!ids.length || !CUSTOM_PROPERTY_TABLE_IDS.includes(tableId as CustomPropertyTableId))
    return {};
  if (tableId === 'team.people') return authorizeTeamRecords(locals, ctx, ids, action);

  const policy = TABLE_MODULE[tableId as keyof typeof TABLE_MODULE];
  const { module } = policy;
  const permission = await moduleAccess(locals, ctx, module, policy.moduleId, action);
  if (!permission.allowed) return {};
  if ((module === 'crm' || module === 'finance') && (await shouldMaskSensitive(locals, module)))
    return {};

  const uuidIds = ids.filter((id) => UUID_RE.test(id));
  if (tableId === 'socials.campaigns') {
    const campaignIds = ids
      .filter((id) => id.startsWith('c:') && id.length > 2)
      .map((id) => id.slice(2));
    if (!campaignIds.length) return {};
    const rows = await withOrgCore(ctx, (tx) =>
      tx
        .selectDistinct({ campaignId: metaAdInsights.campaignId })
        .from(metaAdInsights)
        .innerJoin(
          metaAssets,
          and(
            eq(metaAssets.orgId, metaAdInsights.orgId),
            eq(metaAssets.kind, 'ad_account'),
            eq(metaAssets.externalId, metaAdInsights.adAccountId),
          ),
        )
        .innerJoin(
          metaConnections,
          and(
            eq(metaConnections.id, metaAssets.connectionId),
            eq(metaConnections.orgId, metaAdInsights.orgId),
            ne(metaConnections.status, 'revoked'),
          ),
        )
        .where(
          and(
            eq(metaAdInsights.orgId, ctx.tenantId),
            inArray(metaAdInsights.campaignId, campaignIds),
          ),
        ),
    );
    return accessFor(
      rows.flatMap((row) => (row.campaignId ? [`c:${row.campaignId}`] : [])),
      permission.canEdit,
    );
  }

  if (!uuidIds.length) return {};
  const crmOwnerId = tableId === 'crm.customers' ? await ownerFilter(locals, 'crm') : undefined;
  const found = await withOrgCore(ctx, async (tx) => {
    switch (tableId) {
      case 'stock.items':
        return tx
          .select({ id: stkItems.id })
          .from(stkItems)
          .where(and(eq(stkItems.orgId, ctx.tenantId), inArray(stkItems.id, uuidIds)));
      case 'stock.entries':
        return tx
          .select({ id: stkEntries.id })
          .from(stkEntries)
          .where(and(eq(stkEntries.orgId, ctx.tenantId), inArray(stkEntries.id, uuidIds)));
      case 'pos.catalog':
        return tx
          .select({ id: finProducts.id })
          .from(finProducts)
          .where(and(eq(finProducts.orgId, ctx.tenantId), inArray(finProducts.id, uuidIds)));
      case 'crm.customers': {
        return tx
          .select({ id: crmContacts.id })
          .from(crmContacts)
          .where(
            and(
              eq(crmContacts.orgId, ctx.tenantId),
              inArray(crmContacts.id, uuidIds),
              isNull(crmContacts.deletedAt),
              crmOwnerId ? eq(crmContacts.ownerId, crmOwnerId) : undefined,
            ),
          );
      }
      case 'finances.invoices':
        return tx
          .select({ id: finInvoices.id })
          .from(finInvoices)
          .where(
            and(
              eq(finInvoices.orgId, ctx.tenantId),
              inArray(finInvoices.id, uuidIds),
              eq(finInvoices.shadowed, false),
            ),
          );
      case 'finances.purchases':
        return tx
          .select({ id: finPurchases.id })
          .from(finPurchases)
          .where(and(eq(finPurchases.orgId, ctx.tenantId), inArray(finPurchases.id, uuidIds)));
      case 'scheduling.bookings':
        return tx
          .select({ id: schedBookings.id })
          .from(schedBookings)
          .where(and(eq(schedBookings.orgId, ctx.tenantId), inArray(schedBookings.id, uuidIds)));
      default:
        return [];
    }
  });
  return accessFor(
    found.map((row) => row.id),
    permission.canEdit,
  );
}
