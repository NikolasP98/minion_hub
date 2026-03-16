interface PersonalAgentState {
	agent: PersonalAgentData | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
}

export interface PersonalAgentData {
	id: string;
	userId: string;
	agentId: string;
	displayName: string;
	conversationName: string | null;
	avatarUrl: string | null;
	personalityPreset: string | null;
	personalityText: string | null;
	personalityConfigured: boolean;
	provisioningStatus: string;
	provisioningError: string | null;
	createdAt: number;
	updatedAt: number;
}

let state = $state<PersonalAgentState>({
	agent: null,
	loading: false,
	saving: false,
	error: null,
});

export const personalAgent = {
	get agent() {
		return state.agent;
	},
	get loading() {
		return state.loading;
	},
	get saving() {
		return state.saving;
	},
	get error() {
		return state.error;
	},

	/** Initialize from server-loaded data (avoids a redundant fetch). */
	init(data: PersonalAgentData | null) {
		state.agent = data;
		state.loading = false;
		state.error = null;
	},

	async load() {
		state.loading = true;
		state.error = null;
		try {
			const res = await fetch('/api/personal-agent');
			if (!res.ok) throw new Error('Failed to load agent');
			const data = await res.json();
			state.agent = data.agent;
		} catch (err) {
			state.error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			state.loading = false;
		}
	},

	async save(updates: Partial<PersonalAgentData>) {
		state.saving = true;
		state.error = null;
		try {
			const res = await fetch('/api/personal-agent', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates),
			});
			if (!res.ok) throw new Error('Changes could not be saved. Check your connection and try again.');
			// Optimistically update local state
			if (state.agent) {
				state.agent = { ...state.agent, ...updates, updatedAt: Date.now() };
			}
			// Push to gateway via client-side WebSocket (fire-and-forget)
			try {
				const { sendRequest } = await import('$lib/services/gateway.svelte');
				if (state.agent) {
					await sendRequest('hub.personal-agent.updated', {
						agentId: state.agent.agentId,
						personalityText: updates.personalityText,
						personalityConfigured: updates.personalityText ? true : undefined,
						conversationName: updates.conversationName,
						displayName: updates.displayName,
						avatarUrl: updates.avatarUrl,
					});
				}
			} catch {
				// Gateway push is best-effort; DB is source of truth
				console.warn('[personal-agent] Gateway push failed (will sync on next gateway restart)');
			}
		} catch (err) {
			state.error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			state.saving = false;
		}
	},
};
