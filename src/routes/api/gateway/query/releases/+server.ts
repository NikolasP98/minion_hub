import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { assistantReleases } from '$server/services/assistant-releases.service';

/** Global notes share /changelog's signed-in visibility; assignment remains mandatory. */
export const GET: RequestHandler = async ({ locals, url }) => {
  await resolveAssistantPrincipal(locals, url);
  return json(await assistantReleases(Number(url.searchParams.get('limit') ?? 5)));
};
