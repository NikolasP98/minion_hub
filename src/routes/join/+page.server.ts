import type { Actions, PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { listAllOrganizations } from '$server/services/organizations.service';
import { createRequest, getPendingRequestForUser } from '$server/services/join/requests.service';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth(locals);
  // If the user already has a pending request, send them to the
  // "waiting on approval" screen instead of re-showing the request form.
  if (user.supabaseId) {
    const pending = await getPendingRequestForUser(user.id);
    if (pending) throw redirect(303, '/join/sent');
  }
  return {
    email: user.email ?? '',
    displayName: user.displayName ?? '',
  };
};

export const actions: Actions = {
  default: async ({ locals, request }) => {
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
