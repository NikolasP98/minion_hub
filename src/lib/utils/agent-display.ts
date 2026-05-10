/**
 * Resolve the short display label for an agent. Prefers the `identity.name`
 * field (the user-curated short name from the Identity settings panel),
 * falls back to the legacy `name` field (which may be a long marketing
 * label like "PANIK - Your Personal Assistant"), then to `id`.
 *
 * Use this everywhere the sidebar, header, or any compact surface needs
 * to render an agent's name.
 *
 * Accepts a structural shape so it works with both the gateway `Agent`
 * type (once `identity` lands in @minion-stack/shared) and any local agent
 * shape with `id` + optional `name`.
 */
export interface AgentDisplayInput {
    id: string;
    name?: string;
    identity?: { name?: string } | null;
}

export function agentDisplayName(agent: AgentDisplayInput | null | undefined): string {
    if (!agent) return '';
    return agent.identity?.name?.trim() || agent.name?.trim() || agent.id;
}
