import { sendRequest } from '$lib/services/gateway-rpc';

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
  avatarUrl: string | null;
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
      try {
        await sendRequest('agents.create', data.payload);
        // Mark as active
        await fetch('/api/personal-agent/provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        });
        // displayName lives in the gateway config (`agents.list[].identity.name`)
        // as the single source of truth — /my-agent writes it via config.patch.
        // We no longer push it from the DB via hub.personal-agent.updated.
        await this.load();
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
      if (!res.ok)
        throw new Error('Changes could not be saved. Check your connection and try again.');
      // Optimistically update local state
      if (state.agent) {
        state.agent = { ...state.agent, ...updates, updatedAt: Date.now() };
      }
      // Phase 3c — gateway no longer exposes a `hub.personal-agent.updated`
      // handler (personality + display name + conversation name all live in
      // gateway config now and are written via `config.patch` directly from
      // /my-agent). The hub DB only retains avatarUrl until that surface is
      // moved as well.
    } catch (err) {
      state.error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      state.saving = false;
    }
  },
};
