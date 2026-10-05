import { error } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx, type CoreCtx } from '$server/auth/core-ctx';
import { resolveFreshOrgMemberWithCapability } from '../fresh-org-authority';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type NotificationAdmission = 'manage' | 'create';
const lastReported = new Map<NotificationAdmission, number>();

function unavailable(action: NotificationAdmission): never {
  const now = performance.now();
  const previous = lastReported.get(action);
  if (previous === undefined || now - previous >= 60_000) {
    lastReported.set(action, now);
    try {
      Sentry.captureException(new Error('Notification authority is unavailable'), {
        tags: { area: 'notifications', code: 'authority_unavailable', action },
        fingerprint: ['notifications', 'authority_unavailable', action],
      });
    } catch {
      // Monitoring cannot replace the authorization failure.
    }
  }
  throw error(503, 'Notification permissions are temporarily unavailable.');
}

/** Cached page roles and a platform-admin flag never substitute for current membership. */
export async function requireNotificationAdmission(
  organizationId: string,
  profileId: string,
  action: NotificationAdmission,
): Promise<void> {
  if (!UUID.test(organizationId) || !UUID.test(profileId)) {
    throw error(403, 'Notification access is not permitted.');
  }
  let member: Awaited<ReturnType<typeof resolveFreshOrgMemberWithCapability>>;
  try {
    member = await resolveFreshOrgMemberWithCapability(organizationId, profileId, 'comms', action);
  } catch {
    unavailable(action);
  }
  if (!member) throw error(403, 'Notification access is not permitted.');
}

/** Existing rule endpoints contain organization rules; personal rules use their own owner contract. */
export async function requireNotificationRuleManager(
  locals: App.Locals,
): Promise<CoreCtx & { profileId: string }> {
  const user = requireAuth(locals);
  if (!user.supabaseId) throw error(401, 'A current user session is required.');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'An active organization is required.');
  await requireNotificationAdmission(ctx.tenantId, user.supabaseId, 'manage');
  return { ...ctx, profileId: user.supabaseId };
}
