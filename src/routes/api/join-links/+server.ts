import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { createLink, listLinks } from '$server/services/join/links.service';

export const POST: RequestHandler = async ({ locals, request, url }) => {
  const admin = requireAdmin(locals);
  const b = (await request.json().catch(() => ({}))) as {
    organizationId?: string; role?: string; expiresAt?: string | null; maxUses?: number | null;
  };
  if (!b.organizationId || !b.role) throw error(400, 'organizationId and role required');
  const { id, token } = await createLink({
    organizationId: b.organizationId,
    role: b.role,
    createdBy: admin.id,
    expiresAt: b.expiresAt ?? null,
    maxUses: b.maxUses ?? null,
  });
  return json({ ok: true, id, url: `${url.origin}/join?token=${token}` });
};

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  return json({ links: await listLinks() });
};
