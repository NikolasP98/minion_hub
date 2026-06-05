import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  insertSkillStats,
  listSkillStats,
  getSkillStatsSummary,
} from '$server/services/skill-stats.service';
import { getCoreCtx, requireCoreCtx } from '$server/auth/core-ctx';

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Unauthorized');

  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;
  if (!serverId) throw error(401, 'Server identity required');

  const body = await request.json();
  const stats = Array.isArray(body.stats) ? body.stats : [];
  if (stats.length === 0) return json({ ok: true });

  await insertSkillStats(
    ctx,
    stats.map((s: Record<string, unknown>) => ({ ...s, serverId })),
  );

  return json({ ok: true, count: stats.length });
};

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await requireCoreCtx(locals);

  const serverId = url.searchParams.get('serverId') ?? undefined;
  const skillName = url.searchParams.get('skillName') ?? undefined;
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
  const summary = url.searchParams.get('summary') === 'true';

  if (summary) {
    const result = await getSkillStatsSummary(ctx, { serverId, from, to });
    return json(result);
  }

  const stats = await listSkillStats(ctx, {
    serverId,
    skillName,
    from,
    to,
    limit,
  });

  return json({ stats });
};
