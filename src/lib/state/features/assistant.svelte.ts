/**
 * Floating per-user AI assistant state.
 *
 * The assistant is bound to the logged-in user's personal agent — chat is
 * routed through the gateway's regular chat.send RPC against that agent's
 * main session. The existing agentChat[personalAgentId] state stream powers
 * the conversation UI, so we don't reinvent message rendering or streaming.
 */

interface AssistantState {
    open: boolean;
    /** Resolved personal agent ID (from /api/personal-agent) */
    personalAgentId: string | null;
    loading: boolean;
    error: string | null;
    /** Current scope context shown above input — surfaces what the assistant can see */
    scope: {
        route: string | null;
        agentId: string | null;
    };
}

export const assistant = $state<AssistantState>({
    open: false,
    personalAgentId: null,
    loading: false,
    error: null,
    scope: {
        route: null,
        agentId: null,
    },
});

export function toggleAssistant() {
    assistant.open = !assistant.open;
}

export function openAssistant() {
    assistant.open = true;
}

export function closeAssistant() {
    assistant.open = false;
}

export function setScope(scope: Partial<AssistantState['scope']>) {
    Object.assign(assistant.scope, scope);
}

/**
 * Fetch the user's personal agent ID. Memoized — safe to call repeatedly.
 */
export async function loadPersonalAgent(): Promise<void> {
    if (assistant.personalAgentId || assistant.loading) return;
    assistant.loading = true;
    assistant.error = null;
    try {
        const res = await fetch('/api/personal-agent');
        if (!res.ok) {
            assistant.error = res.status === 401 ? 'Sign in to use the assistant' : 'Assistant unavailable';
            return;
        }
        const data = (await res.json()) as { agent: { agentId?: string | null } | null };
        if (data.agent?.agentId) {
            assistant.personalAgentId = data.agent.agentId;
        } else {
            assistant.error = 'No personal agent provisioned';
        }
    } catch (e) {
        assistant.error = e instanceof Error ? e.message : 'Failed to load assistant';
    } finally {
        assistant.loading = false;
    }
}
