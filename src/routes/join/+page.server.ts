import type { Actions, PageServerLoad } from './$types';
import * as m from '$lib/paraglide/messages';
import { redirect, error, fail } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { listAllOrganizations } from '$server/services/organizations.service';
import {
  createRequest,
  getPendingRequestForOrganization,
} from '$server/services/join/requests.service';
import { joinMessage, readJoinRequestForm } from '$server/services/join/request-input';
import { resolveJoinRequestTarget } from '$server/services/join/request-target';
import { resolveLink, consumeLink } from '$server/services/join/links.service';
import { isLinkUsable } from '$server/services/join/helpers';
import { isOrgMember } from '$server/services/join/membership';

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireAuth(locals);

  // Join-link path: `/join?token=…` (the URL `createLink` hands out). Read-only
  // here — the membership grant happens in the `consume` action (never mutate in
  // a load: it can run on prefetch / multiple times). Shows a confirmation card.
  const token = url.searchParams.get('token');
  if (token) {
    const link = await resolveLink(token);
    // Already a member of this org (e.g. approved out-of-band, or they already
    // consumed the link) → don't strand them on the invite card. Send them home.
    if (link && user.supabaseId && (await isOrgMember(user.supabaseId, link.organization_id))) {
      throw redirect(303, '/');
    }
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

  // Resolve the form's target first: membership or pending requests elsewhere
  // must not suppress access to this workspace.
  const target = await resolveJoinRequestTarget();
  if (user.supabaseId && (await isOrgMember(user.supabaseId, target.id))) throw redirect(303, '/');
  if (await getPendingRequestForOrganization(user.id, target.id)) throw redirect(303, '/join/sent');
  return {
    mode: 'request' as const,
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    target,
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
      return fail(400, {
        error: (e as Error).message || 'This invite link is invalid or expired.',
      });
    }
    throw redirect(303, '/');
  },

  request: async ({ locals, request }) => {
    const user = requireAuth(locals);
    if (!user.supabaseId) throw error(400, 'Supabase session required to request access.');

    const fd = await readJoinRequestForm(request);
    const message = joinMessage(fd.get('message'));

    const org = await resolveJoinRequestTarget();
    // Client data is only a stale-form check; the server still chooses the target.
    if (fd.get('targetOrganizationId') !== org.id) {
      return fail(409, {
        error: m.join_targetChanged(),
      });
    }

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
