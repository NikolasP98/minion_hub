import type { CoreCtx } from '$server/auth/core-ctx';
import {
  resolveAttachmentAccess,
  requireAnyAttachmentCapability,
} from '$server/services/attachment-access';

/** Request capabilities are resolved once. Actual record/file ownership is
 * checked again inside the service's transaction, including force deletion. */
export async function getAttachmentAccess(
  locals: App.Locals,
  ctx: CoreCtx,
  action: 'view' | 'edit' = 'view',
) {
  const access = await resolveAttachmentAccess(locals, ctx);
  requireAnyAttachmentCapability(access, action);
  return access;
}
