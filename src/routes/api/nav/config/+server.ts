import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { invalidateRbac, requireOrgCapability } from '$server/services/rbac.service';
import {
  deleteOrphanPageRules,
  readNavConfig,
  writeNavConfig,
} from '$server/services/nav-config.service';
import { navConfigSchema } from '$lib/nav/nav-config-schema';
import {
  aliasableTargets,
  navPageKeys,
  reservedSectionSlugs,
  validateNavConfig,
} from '$lib/nav/custom-sections';

/** GET /api/nav/config — the full org nav config; settings:manage only. */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await readNavConfig(ctx));
};

/** PUT /api/nav/config — replace the whole document after semantic validation. */
export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, navConfigSchema);
  const issues = validateNavConfig(body, {
    reserved: reservedSectionSlugs(),
    targets: new Set(aliasableTargets().map((t) => t.pattern)),
  });
  if (issues.length > 0) return json({ error: 'invalid_nav_config', issues }, { status: 400 });
  const stored = await writeNavConfig(ctx, body);
  await deleteOrphanPageRules(ctx.tenantId, [
    ...navPageKeys(body).map((l) => l.key),
    ...body.sections.map((s) => `section:${s.id}`),
  ]);
  await invalidateRbac(ctx.tenantId);
  return json(stored);
};
