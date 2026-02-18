<script lang="ts">
  import { gw } from '$lib/state/gateway-data.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { missionsState } from '$lib/state/missions.svelte';

  let { agentId, serverId }: { agentId: string; serverId: string | null } = $props();

  const agentSessions = $derived(
    gw.sessions.filter((s) => {
      const sk = (s as { sessionKey?: string }).sessionKey ?? '';
      return sk.includes(`agent:${agentId}:`);
    })
  );

  function truncKey(sk?: string) {
    if (!sk) return '—';
    const parts = sk.split(':');
    return parts.length > 2 ? parts.slice(2).join(':').slice(0, 16) : sk.slice(0, 16);
  }

  async function fetchMissions(sessionKey: string) {
    if (!serverId) return;
    const sess = agentSessions.find(
      (s) => (s as { sessionKey?: string }).sessionKey === sessionKey
    ) as { id?: string } | undefined;
    const sessionId = sess?.id ?? sessionKey;
    try {
      const res = await fetch(`/api/servers/${serverId}/missions?sessionId=${sessionId}`);
      if (!res.ok) return;
      const { missions } = await res.json();
      missionsState.missionsBySession[sessionKey] = missions;
      if (missions.length > 0 && !ui.selectedMissionId) {
        ui.selectedMissionId = missions[0].id;
      }
    } catch { /* non-critical */ }
  }

  function onSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    ui.selectedSessionKey = val || null;
    ui.selectedMissionId = null;
    if (val) fetchMissions(val);
  }

  $effect(() => {
    if (!ui.selectedSessionKey && agentSessions.length > 0) {
      const first = (agentSessions[0] as { sessionKey?: string }).sessionKey ?? null;
      ui.selectedSessionKey = first;
      if (first) fetchMissions(first);
    }
  });
</script>

<div class="session-bar">
  <label class="session-label" for="session-select">Session</label>
  <select id="session-select" class="session-select" value={ui.selectedSessionKey ?? ''} onchange={onSelect}>
    {#each agentSessions as sess ((sess as { sessionKey?: string }).sessionKey)}
      {@const sk = (sess as { sessionKey?: string }).sessionKey ?? ''}
      <option value={sk}>{(sess as { label?: string }).label || truncKey(sk)}</option>
    {/each}
  </select>
  <span class="session-count">{agentSessions.length}</span>
</div>

<style>
  .session-bar {
    flex-shrink: 0;
    padding: 6px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .session-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text3);
  }
  .session-select {
    flex: 1;
    min-width: 0;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    padding: 3px 6px;
    outline: none;
  }
  .session-select:focus { border-color: var(--accent); }
  .session-count {
    font-size: 10px;
    color: var(--text3);
    opacity: 0.65;
  }
</style>
