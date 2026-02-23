/**
 * Parse an agent session key like "agent:panik:whatsapp:direct:+51922286663"
 * into { agentId: "panik", rest: "whatsapp:direct:+51922286663" }.
 */
export function parseAgentSessionKey(
  sessionKey: string | undefined | null
): { agentId: string; rest: string } | null {
  const raw = (sessionKey ?? '').trim();
  if (!raw) return null;
  const parts = raw.split(':').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'agent') return null;
  const agentId = parts[1]?.trim();
  const rest = parts.slice(2).join(':');
  if (!agentId || !rest) return null;
  return { agentId, rest };
}
