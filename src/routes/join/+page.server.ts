import type { Actions, PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getDb } from '$server/db/client';
import { organization } from '@minion-stack/db/schema';
import { submitJoinRequest } from '$server/services/join-request.service';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth(locals);
  // Only show this page to users without an org membership
  // (layout.server.ts already redirects here, but double-check)
  return {
    email: user.email ?? '',
    displayName: user.displayName ?? '',
  };
};

export const actions: Actions = {
  default: async ({ locals, request }) => {
    const user = requireAuth(locals);
    const db = getDb();

    const fd = await request.formData();
    const message = String(fd.get('message') ?? '').trim();

    // Find the first organization (default tenant)
    const [org] = await db.select({ id: organization.id, name: organization.name })
      .from(organization)
      .limit(1);

    if (!org) {
      throw error(500, 'No organization configured on this hub.');
    }

    await submitJoinRequest(db, {
      userId: user.id,
      orgId: org.id,
      email: user.email ?? '',
      message: message || undefined,
    });

    throw redirect(303, '/join/sent');
  },
};
