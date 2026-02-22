import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listUsers, createContactUser } from '$server/services/user.service';

const VALID_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
type Role = (typeof VALID_ROLES)[number];

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.tenantCtx) throw error(401);

  const users = await listUsers(locals.tenantCtx);
  return json({ users });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  const b = body as Record<string, unknown>;

  if (!b.email || typeof b.email !== 'string') throw error(400, 'email is required');
  if (!b.password || typeof b.password !== 'string') throw error(400, 'password is required');

  const role = typeof b.role === 'string' && VALID_ROLES.includes(b.role as Role)
    ? (b.role as Role)
    : 'viewer';

  const id = await createContactUser(locals.tenantCtx, {
    email: b.email,
    password: b.password,
    displayName: typeof b.displayName === 'string' ? b.displayName : undefined,
    role,
  });
  return json({ ok: true, id });
};
