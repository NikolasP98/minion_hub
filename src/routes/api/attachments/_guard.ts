import { error } from '@sveltejs/kit';
import { hasOrgCapability } from '$server/services/rbac.service';
import {
  ATTACHMENT_OBJECT_MODULE,
  type AttachmentObjectRef,
} from '$server/services/attachments.service';

/** Attachments are cross-module, so the central `/api/*` prefix guard cannot
 *  gate them: each link/unlink requires `edit` on the LINKED OBJECT's module. */
export async function assertCanEditLinks(
  locals: App.Locals,
  refs: readonly AttachmentObjectRef[],
): Promise<void> {
  const modules = new Set(refs.map((r) => ATTACHMENT_OBJECT_MODULE[r.objectType]));
  for (const module of modules) {
    if (!(await hasOrgCapability(locals, module, 'edit'))) {
      throw error(403, 'You do not have permission to perform this action.');
    }
  }
}
