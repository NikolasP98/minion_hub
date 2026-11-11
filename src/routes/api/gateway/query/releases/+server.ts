import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { assistantReleases } from '$server/services/assistant-releases.service';

/**
 * GET /api/gateway/query/releases?agentId=personal-<uuid>[&orgId=][&limit=]
 * On-demand global Minion Hub notes share /changelog's signed-in visibility;
 * a valid assigned principal is mandatory, with no business-module capability.
 * limit is 1..20 (default 5). Returns version/date/sections/validated Hub PR links
 * with total/returned/truncated and contentTruncated coverage. Content bounds
 * are owned by assistantReleases; notes are not fetched on every assistant turn.
 * This source does not identify the installed Gateway version.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  await resolveAssistantPrincipal(locals, url);
  return json(await assistantReleases(Number(url.searchParams.get('limit') ?? 5)));
};
