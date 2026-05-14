/**
 * Floating per-user AI assistant state.
 *
 * The assistant is bound to the logged-in user's personal agent — chat is
 * routed through the gateway's regular chat.send RPC against that agent's
 * main session. The existing agentChat[personalAgentId] state stream powers
 * the conversation UI, so we don't reinvent message rendering or streaming.
 *
 * personalAgent data flows through the canonical (app)/+layout.server.ts
 * load bundle into page.data — no client fetch on mount.
 */

import { page } from '$app/state';

interface AssistantUiState {
    open: boolean;
    /** Current scope context shown above input — surfaces what the assistant can see */
    scope: {
        route: string | null;
        agentId: string | null;
    };
}

const ui = $state<AssistantUiState>({
    open: false,
    scope: {
        route: null,
        agentId: null,
    },
});

type PersonalAgentEntry = { agentId?: string | null } | null;

function pagePersonalAgent(): PersonalAgentEntry {
    const data = page.data as { personalAgent?: { agent: PersonalAgentEntry } | null } | undefined;
    return data?.personalAgent?.agent ?? null;
}

/**
 * Public state surface. personalAgentId/loading/error are getters over
 * page.data so the canonical server-load is the single source of truth.
 */
export const assistant = {
    get open() {
        return ui.open;
    },
    set open(value: boolean) {
        ui.open = value;
    },
    get scope() {
        return ui.scope;
    },
    get personalAgentId(): string | null {
        return pagePersonalAgent()?.agentId ?? null;
    },
    /**
     * No client-side loading anymore — kept for source compatibility.
     */
    get loading(): boolean {
        return false;
    },
    get error(): string | null {
        // Synthesize an error message when the server-load returned no
        // personal agent (rare; means the user has no provisioned agent).
        const data = page.data as { personalAgent?: unknown } | undefined;
        if (data && 'personalAgent' in (data ?? {})) {
            const agent = pagePersonalAgent();
            if (!agent?.agentId) return 'No personal agent provisioned';
        }
        return null;
    },
};

export function toggleAssistant() {
    ui.open = !ui.open;
}

export function openAssistant() {
    ui.open = true;
}

export function closeAssistant() {
    ui.open = false;
}

export function setScope(scope: Partial<AssistantUiState['scope']>) {
    Object.assign(ui.scope, scope);
}

/**
 * No-op shim: data is now hydrated via the (app)/+layout.server.ts bundle
 * and exposed through `assistant.personalAgentId`. Kept so existing
 * callsites (e.g. FloatingAssistant.svelte onMount) don't break.
 */
export function loadPersonalAgent(): void {
    /* no-op — see module docblock */
}
