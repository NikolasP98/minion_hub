import { json, error, type RequestHandler } from '@sveltejs/kit';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { canonicalAgentMemory } from '$server/services/canonical-agent-memory.service';
/** Shared Hub personal-agent memory authority; each channel supplies its trusted admission context. */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const principal = await resolveAssistantPrincipal(locals, url);
  const revalidate = async () => {
    const current = await resolveAssistantPrincipal(locals, url);
    if (current.principalId !== principal.principalId || current.orgId !== principal.orgId)
      throw error(403, 'Memory authority changed');
  };
  const agentId = url.searchParams.get('agentId');
  if (!agentId) throw error(400, 'Agent required');
  const raw = await request.text();
  if (raw.length > 16000) throw error(413, 'Memory request too large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw error(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'Invalid body');
  const { operation, args } = body as Record<string, unknown>;
  if (typeof operation !== 'string' || !args || typeof args !== 'object' || Array.isArray(args))
    throw error(400, 'Invalid operation');
  await revalidate();
  const result = await canonicalAgentMemory(
    { ...principal, agentId },
    operation,
    args as Record<string, unknown>,
    revalidate,
  );
  await revalidate();
  return json({ result });
};
