/**
 * Remote functions for the admin join-requests / join-links page
 * (`(app)/users/join-requests`). Replaces the per-action `fetch('/api/...')`
 * glue + 4× `invalidateAll()` round-trips with typed queries and commands that
 * single-flight-refresh the affected query server-side.
 *
 * Mirrors the service calls of the `/api/join-requests/*` and `/api/join-links/*`
 * routes (which stay in place for non-page callers, e.g. the public /join flow).
 *
 * Auth: list queries match the page's `can('users.manage')` gate (the data this
 * page was already allowed to read); mutations match the routes' admin gate.
 */
import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { can } from '$lib/access/policy';
import { currentUser, currentAdmin } from '$server/remote/guard';
import {
  listPendingRequests,
  approveRequest,
  denyRequest,
} from '$server/services/join/requests.service';
import { listLinks, createLink, revokeLink } from '$server/services/join/links.service';

function requireManageUsers() {
  const user = currentUser();
  if (!can('users.manage', user)) error(403, 'Admin access required');
  return user;
}

/** Pending join requests (admin/users.manage). */
export const listJoinRequests = query(async () => {
  requireManageUsers();
  return listPendingRequests();
});

/** Active join links (admin/users.manage). */
export const listJoinLinks = query(async () => {
  requireManageUsers();
  return listLinks();
});

const roleEnum = z.enum(['user', 'admin']);

/** Approve a pending request into an organization with a role. */
export const approveJoinRequest = command(
  z.object({ id: z.string().min(1), organizationId: z.string().min(1), role: roleEnum }),
  async ({ id, organizationId, role }) => {
    const admin = currentAdmin();
    await approveRequest(id, { reviewerId: admin.id, role, organizationId });
    void listJoinRequests().refresh();
    return { ok: true as const };
  },
);

/** Deny a pending request. */
export const denyJoinRequest = command(z.string().min(1), async (id) => {
  const admin = currentAdmin();
  await denyRequest(id, admin.id);
  void listJoinRequests().refresh();
  return { ok: true as const };
});

/** Mint a join link; returns the shareable URL. */
export const mintJoinLink = command(
  z.object({ organizationId: z.string().min(1), role: roleEnum }),
  async ({ organizationId, role }) => {
    const admin = currentAdmin();
    const { token } = await createLink({
      organizationId,
      role,
      createdBy: admin.id,
      expiresAt: null,
      maxUses: null,
    });
    void listJoinLinks().refresh();
    return { url: `${getRequestEvent().url.origin}/join?token=${token}` };
  },
);

/** Revoke a join link. */
export const revokeJoinLink = command(z.string().min(1), async (id) => {
  currentAdmin();
  await revokeLink(id);
  void listJoinLinks().refresh();
  return { ok: true as const };
});
