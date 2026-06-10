import type { Actions, PageServerLoad } from './$types';
import { redirect, error, fail } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { listAllOrganizations } from '$server/services/organizations.service';
import { createRequest, getPendingRequestForUser } from '$server/services/join/requests.service';
import { resolveLink, consumeLink } from '$server/services/join/links.service';
import { isLinkUsable } from '$server/services/join/helpers';

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireAuth(locals);

  // Join-link path: `/join?token=…` (the URL `createLink` hands out). Read-only
  // here — the membership grant happens in the `consume` action (never mutate in
  // a load: it can run on prefetch / multiple times). Shows a confirmation card.
  const token = url.searchParams.get('token');
  if (token) {
    const link = await resolveLink(token);
    const usable =
      link &&
      isLinkUsable(
        {
          revoked: link.revoked,
          expiresAt: link.expires_at ? new Date(link.expires_at) : null,
          maxUses: link.max_uses,
          usesCount: link.uses_count,
        },
        new Date(),
      );
    if (!link || !usable) {
      return {
        mode: 'link' as const,
        token,
        orgName: null,
        role: null,
        linkError: 'This invite link is invalid or expired.',
      };
    }
    const org = (await listAllOrganizations()).find((o) => o.id === link.organization_id);
    return {
      mode: 'link' as const,
      token,
      orgName: org?.name ?? 'the organization',
      role: link.role,
      linkError: null,
    };
  }

  // No token → request-access flow. If the user already has a pending request,
  // send them to the "waiting on approval" screen instead of the request form.
  if (user.supabaseId) {
    const pending = await getPendingRequestForUser(user.id);
    if (pending) throw redirect(303, '/join/sent');
  }
  return {
    mode: 'request' as const,
    email: user.email ?? '',
    displayName: user.displayName ?? '',
  };
};

export const actions: Actions = {
  // Consume a join-link → grant org membership for the authenticated user.
  consume: async ({ locals, request }) => {
    const user = requireAuth(locals);
    if (!user.supabaseId) throw error(400, 'Supabase session required to accept an invite.');
    const fd = await request.formData();
    const token = String(fd.get('token') ?? '').trim();
    if (!token) return fail(400, { error: 'Missing invite token.' });
    try {
      await consumeLink(token, {
        id: user.id,
        supabaseId: user.supabaseId,
        email: user.email ?? '',
        displayName: user.displayName ?? null,
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message || 'This invite link is invalid or expired.' });
    }
    throw redirect(303, '/');
  },

  request: async ({ locals, request }) => {
    const user = requireAuth(locals);
    if (!user.supabaseId) throw error(400, 'Supabase session required to request access.');

    const fd = await request.formData();
    const message = String(fd.get('message') ?? '').trim();

    // Default tenant the request is filed against — the first Supabase org
    // (the same store the approve→organization_members grant writes to).
    const [org] = await listAllOrganizations();
    if (!org) throw error(500, 'No organization configured on this hub.');

    // Supabase `join_request` is the system-of-record (read by the admin
    // review UI + the approve→organization_members grant). createRequest is
    // idempotent: an existing pending request is returned, not duplicated.
    await createRequest(
      {
        id: user.id,
        supabaseId: user.supabaseId,
        email: user.email ?? '',
        displayName: user.displayName ?? null,
      },
      org.id,
      message || undefined,
    );

    throw redirect(303, '/join/sent');
  },
};
