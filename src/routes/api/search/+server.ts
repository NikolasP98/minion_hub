import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { searchRecords } from '$server/services/search.service';

/** GET /api/search?q= — global record search for the command palette. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const hits = await searchRecords(ctx, url.searchParams.get('q') ?? '');
  return json({ hits });
};
