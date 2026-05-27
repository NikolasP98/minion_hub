import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import {
  getActivityBins,
  upsertActivityBins,
  pruneOldActivityBins,
} from '$server/services/activity-bins.service';
import { requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const ctx = requireTenantCtx(locals);
  const since = Number(url.searchParams.get('since') ?? '0');
  try {
    const bins = await getActivityBins(ctx, params.id!, since);
    return json({ bins });
  } catch {
    return json({ bins: [] });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = requireTenantCtx(locals);
  try {
    const body = await request.json();
    const bins = (body.bins ?? []) as Array<{ agentId: string; binTs: number; count: number }>;
    const validBins = bins.filter(
      (b) =>
        typeof b.agentId === 'string' && typeof b.binTs === 'number' && typeof b.count === 'number',
    );
    await upsertActivityBins(ctx, params.id!, validBins);
    await pruneOldActivityBins(ctx, params.id!, Date.now() - 90_000_000);
    return json({ ok: true });
  } catch (e) {
    console.error(`[POST /api/servers/${params.id}/activity-bins]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
