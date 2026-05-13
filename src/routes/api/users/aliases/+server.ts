import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { isAliasTaken, listAliases } from '$server/services/user.service';
import { normalizeAlias, validateAlias } from '$lib/utils/alias';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);
  const ctx = locals.tenantCtx;

  const check = url.searchParams.get('check');
  if (check !== null) {
    const normalized = normalizeAlias(check);
    if (!normalized) return json({ available: false, reason: 'invalid' });
    const fmt = validateAlias(normalized);
    if (!fmt.ok) return json({ available: false, reason: 'invalid' });
    const taken = await isAliasTaken(ctx, normalized);
    return json({ available: !taken, reason: taken ? 'taken' : undefined });
  }

  const aliases = await listAliases(ctx);
  return json({ aliases });
};
