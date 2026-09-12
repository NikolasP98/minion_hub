import { and, eq, isNull } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { CoreTx } from '$server/db/with-org-core';
import type { AttachmentObjectType } from '$server/db/pg-attachments-schema';
import { crmContacts } from '$server/db/pg-crm-schema';
import { schedBookings, schedEventTypes } from '$server/db/pg-scheduling-schema';
import { finInvoices, finProducts } from '$server/db/pg-finance-schema';
import { stkItems, stkEntries } from '$server/db/pg-schema/stock';
import { posTickets } from '$server/db/pg-pos-schema';
import { hasOrgCapability, ownerFilter, type Module } from './rbac.service';

export const ATTACHMENT_OBJECT_MODULE = {
  crm_contact: 'crm',
  booking: 'scheduling',
  event_type: 'scheduling',
  product: 'pos',
  stk_item: 'stock',
  stk_entry: 'stock',
  fin_invoice: 'finance',
  pos_ticket: 'pos',
} as const satisfies Record<AttachmentObjectType, Module>;
export interface AttachmentObjectRef {
  objectType: AttachmentObjectType;
  objectId: string;
}
export interface Actor {
  id: string | null;
  name: string | null;
}
export type AttachmentErrorCode =
  | 'not_found'
  | 'upload_missing'
  | 'too_large'
  | 'mime_not_allowed'
  | 'quota_exceeded'
  | 'still_linked'
  | 'busy';
export class AttachmentError extends Error {
  constructor(
    public code: AttachmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentError';
  }
}
export type AttachmentModule = (typeof ATTACHMENT_OBJECT_MODULE)[AttachmentObjectType];
export interface AttachmentAccess {
  tenantId: string;
  profileId: string;
  modules: Record<AttachmentModule, { view: boolean; edit: boolean; ownerId?: string }>;
}
export async function resolveAttachmentAccess(
  locals: App.Locals,
  ctx: CoreCtx,
): Promise<AttachmentAccess> {
  const profileId = locals.user?.supabaseId;
  if (!profileId || profileId !== ctx.profileId) throw error(401, 'Authentication required');
  const modules = {} as AttachmentAccess['modules'];
  for (const module of new Set(Object.values(ATTACHMENT_OBJECT_MODULE))) {
    const [view, edit, ownerId] = await Promise.all([
      hasOrgCapability(locals, module, 'view'),
      hasOrgCapability(locals, module, 'edit'),
      ownerFilter(locals, module),
    ]);
    modules[module] = { view, edit, ownerId };
  }
  return { tenantId: ctx.tenantId, profileId, modules };
}
export function requireAnyAttachmentCapability(access: AttachmentAccess, action: 'view' | 'edit') {
  if (!Object.values(access.modules).some((cap) => cap.view && (action === 'view' || cap.edit))) {
    throw error(403, 'You do not have permission to perform this action.');
  }
}
export function requireAccessIdentity(ctx: CoreCtx, access: AttachmentAccess) {
  if (!access || access.tenantId !== ctx.tenantId || access.profileId !== ctx.profileId) {
    throw new AttachmentError('not_found', 'attachment not found');
  }
}
const objects = {
  crm_contact: crmContacts,
  booking: schedBookings,
  event_type: schedEventTypes,
  product: finProducts,
  stk_item: stkItems,
  stk_entry: stkEntries,
  fin_invoice: finInvoices,
  pos_ticket: posTickets,
};
/** Record rows precede file rows in the lock order. Booking deletion holds the
 * booking lock before calling detachObjectAttachmentsInTx; never invert it. */
export async function lockAttachmentObjectsInTx(
  tx: CoreTx,
  ctx: Pick<CoreCtx, 'tenantId'>,
  refs: readonly AttachmentObjectRef[],
) {
  const sorted = [
    ...new Map(refs.map((ref) => [`${ref.objectType}:${ref.objectId}`, ref])).values(),
  ].sort((a, b) => `${a.objectType}:${a.objectId}`.localeCompare(`${b.objectType}:${b.objectId}`));
  for (const ref of sorted) {
    const table = objects[ref.objectType];
    if (!table) throw new AttachmentError('not_found', 'record not found');
    await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, ref.objectId), eq(table.orgId, ctx.tenantId)))
      .for('share');
  }
}
export async function canAccessAttachmentObject(
  tx: CoreTx,
  ctx: CoreCtx,
  access: AttachmentAccess,
  ref: AttachmentObjectRef,
  action: 'view' | 'edit',
) {
  requireAccessIdentity(ctx, access);
  const module = ATTACHMENT_OBJECT_MODULE[ref.objectType];
  const cap = access.modules[module];
  if (!cap?.view || (action === 'edit' && !cap.edit)) return false;
  if (ref.objectType === 'crm_contact') {
    const rows = await tx
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.orgId, ctx.tenantId),
          eq(crmContacts.id, ref.objectId),
          isNull(crmContacts.deletedAt),
          cap.ownerId ? eq(crmContacts.ownerId, cap.ownerId) : undefined,
        ),
      );
    return rows.length > 0;
  }
  const table = objects[ref.objectType];
  if (!table) return false;
  return (
    (
      await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, ref.objectId), eq(table.orgId, ctx.tenantId)))
    ).length > 0
  );
}
export async function requireAttachmentObject(
  tx: CoreTx,
  ctx: CoreCtx,
  access: AttachmentAccess,
  ref: AttachmentObjectRef,
  action: 'view' | 'edit',
) {
  if (!(await canAccessAttachmentObject(tx, ctx, access, ref, action)))
    throw new AttachmentError('not_found', 'record not found');
}
