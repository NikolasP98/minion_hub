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
import { personalAgentName } from '$lib/state/features/personal-agent-names.svelte';

export interface AgentDisplayInput {
    id: string;
    name?: string;
    identity?: { name?: string } | null;
}

export function agentDisplayName(agent: AgentDisplayInput | null | undefined): string {
    if (!agent) return '';
    const curated = agent.identity?.name?.trim() || agent.name?.trim();
    if (curated) return curated;

    // Personal agents have machine ids like `personal-<40-char user hash>` and
    // usually no curated name. Prefer the owner's username (loaded into the
    // personal-agent-names store from /api/personal-agents); fall back to a tidy
    // hash-prefixed label so the id never renders raw.
    const personal = /^personal-(.+)$/.exec(agent.id);
    if (personal) {
        const owner = personalAgentName(agent.id);
        if (owner) return owner;
        return `Personal · ${personal[1].slice(0, 6)}`;
    }

    return agent.id;
}
