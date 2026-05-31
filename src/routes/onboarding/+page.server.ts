import type { Actions, PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getPersonalAgent, updateProvisioningStatus } from '$server/services/personal-agent.service';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx) throw redirect(303, '/login');

  const existing = await getPersonalAgent(ctx, user.id);
  if (existing && existing.provisioningStatus === 'active') {
    throw redirect(303, '/');
  }

  return {
    user: {
      id: user.id,
      email: user.email ?? '',
      displayName: user.displayName ?? user.email ?? '',
    },
  };
};

export const actions: Actions = {
  complete: async ({ locals, request }) => {
    const user = requireAuth(locals);
    const ctx = await getTenantCtx(locals as App.Locals);
    if (!ctx) throw redirect(303, '/login');

    const fd = await request.formData();
    const agentName = String(fd.get('agentName') ?? '').trim();
    const personality = String(fd.get('personality') ?? 'casual');

    // Mark the personal agent as active with the chosen name
    const existing = await getPersonalAgent(ctx, user.id);
    if (existing) {
      await updateProvisioningStatus(ctx, user.id, 'active');
    }

    throw redirect(303, `/onboarding/complete?name=${encodeURIComponent(agentName)}&vibe=${encodeURIComponent(personality)}`);
  },
};
