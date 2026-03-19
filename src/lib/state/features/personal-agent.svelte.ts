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

	/**
	 * Check if this user's personal agent needs gateway provisioning and trigger it.
	 * Called on page load -- fetches provisioning status from server, then calls
	 * agents.create via the browser WebSocket if needed. Reports result back to server.
	 * Silently fails -- will retry on next page load via exponential backoff.
	 */
	async checkAndProvision() {
		try {
			const res = await fetch('/api/personal-agent/provision');
			if (!res.ok) return;
			const data = await res.json();
			if (!data.needsProvisioning) return;

			// Call gateway to create the agent workspace
			const { sendRequest } = await import('$lib/services/gateway.svelte');
			try {
				await sendRequest('agents.create', data.payload);
				// Mark as active
				await fetch('/api/personal-agent/provision', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ status: 'active' }),
				});
			} catch (err) {
				// Mark as error
				await fetch('/api/personal-agent/provision', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						status: 'error',
						error: err instanceof Error ? err.message : 'Gateway unreachable',
					}),
				});
			}
			// Always reload so client state reflects the DB outcome
			await this.load();
		} catch {
			// Silently fail -- will retry next page load
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
