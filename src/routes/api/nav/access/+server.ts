import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { sectionAccessTargetSchema } from '$lib/nav/section-access';
import { requireOrgCapability } from '$server/services/rbac.service';
import { readSectionAccess, writeSectionAccess } from '$server/services/section-access.service';
import { resolvePolicyReturnLocation } from '$server/services/section-access-return';

const headers = { 'Cache-Control': 'private, no-store' };
export const GET: RequestHandler = async ({ locals, url }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  const parsed = sectionAccessTargetSchema.safeParse(url.searchParams.get('target'));
  if (!parsed.success) throw error(400, 'Valid target required');
  return json(await readSectionAccess(locals, parsed.data), { headers });
};
export const PUT: RequestHandler = async (event) => {
  await requireOrgCapability(event.locals, 'users', 'manage');
  const body: unknown = await event.request.json().catch(() => null);
  const receipt = await writeSectionAccess(event.locals, body);
  // Persistence has committed. A subsequent read/navigation failure must never
  // be presented as a rejected save or encourage resubmitting the mutation.
  const location = await resolvePolicyReturnLocation(event).catch(() => '/account/home');
  return json({ ...receipt, location }, { headers });
};
