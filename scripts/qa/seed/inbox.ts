/**
 * In-app inbox (spec 2026-10-10-hub-inbox-notifications-reminders, Slice 1).
 * One row per scope tier + one resolved + one read, per the spec's DoD:
 * - inbox.notification.global  — scope global, everyone sees it.
 * - inbox.notification.org     — scope org, ORG_BUSINESS members only.
 * - inbox.notification.role    — scope role, capability 'pos:manage' (the
 *   default matrix grants this to owner/admin/manager, NOT staff — the row
 *   that proves "a role row is visible only to a holder of that capability").
 * - inbox.notification.user    — scope user, 'tenancy.user.staff' only.
 * - inbox.notification.resolved — scope org, already resolved_at (hidden by
 *   default from the feed and the badge).
 * - inbox.notification.read    — scope user, 'tenancy.user.staff', with an
 *   app_notification_reads row (read_at set) for that same user.
 */
import { matrixUuid } from './ids';
import { ORG_BUSINESS, userId } from './tenancy';
import type { SeedContext } from './db';

export const NOTIF_GLOBAL = matrixUuid('inbox.notification.global');
export const NOTIF_ORG = matrixUuid('inbox.notification.org');
export const NOTIF_ROLE = matrixUuid('inbox.notification.role');
export const NOTIF_USER = matrixUuid('inbox.notification.user');
export const NOTIF_RESOLVED = matrixUuid('inbox.notification.resolved');
export const NOTIF_READ = matrixUuid('inbox.notification.read');

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register } = ctx;
  const staff = userId('tenancy.user.staff');

  await sql`
    insert into app_notifications
      (id, scope, org_id, capability, profile_id, kind, severity, title, dedupe_key, resolved_at)
    values
      (${NOTIF_GLOBAL}, 'global', null, null, null, 'app.update', 'info',
        'QA release notice', 'qa:inbox:global', null),
      (${NOTIF_ORG}, 'org', ${ORG_BUSINESS}, null, null, 'org.notice', 'info',
        'QA org notice', 'qa:inbox:org', null),
      (${NOTIF_ROLE}, 'role', ${ORG_BUSINESS}, 'pos:manage', null, 'visit.unpaid', 'warning',
        'QA role notice (pos:manage)', 'qa:inbox:role', null),
      (${NOTIF_USER}, 'user', ${ORG_BUSINESS}, null, ${staff}, 'appointment.overdue', 'critical',
        'QA user notice (staff)', 'qa:inbox:user', null),
      (${NOTIF_RESOLVED}, 'org', ${ORG_BUSINESS}, null, null, 'org.notice', 'info',
        'QA resolved notice', 'qa:inbox:resolved', now()),
      (${NOTIF_READ}, 'user', ${ORG_BUSINESS}, null, ${staff}, 'daily.feed', 'info',
        'QA read notice (staff)', 'qa:inbox:read', null)
    on conflict (dedupe_key) where dedupe_key is not null do update set title = excluded.title
  `;

  await sql`
    insert into app_notification_reads (profile_id, notification_id, read_at)
    values (${staff}, ${NOTIF_READ}, now())
    on conflict (profile_id, notification_id) do update set read_at = excluded.read_at
  `;

  register('inbox.notification.global', {
    table: 'app_notifications',
    where: { id: NOTIF_GLOBAL },
  });
  register('inbox.notification.org', { table: 'app_notifications', where: { id: NOTIF_ORG } });
  register('inbox.notification.role', { table: 'app_notifications', where: { id: NOTIF_ROLE } });
  register('inbox.notification.user', { table: 'app_notifications', where: { id: NOTIF_USER } });
  register('inbox.notification.resolved', {
    table: 'app_notifications',
    where: { id: NOTIF_RESOLVED },
  });
  register('inbox.notification.read', { table: 'app_notifications', where: { id: NOTIF_READ } });
}
