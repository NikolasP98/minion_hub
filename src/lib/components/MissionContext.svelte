<script lang="ts">
  import { ui } from '$lib/state/ui.svelte';
  import { missionsState } from '$lib/state/missions.svelte';

  let { sessionKey, serverId }: { sessionKey: string; serverId: string | null } = $props();

  const missions = $derived(missionsState.missionsBySession[sessionKey] ?? []);

  async function fetchTasks(missionId: string) {
    if (!serverId) return;
    try {
      const res = await fetch(`/api/servers/${serverId}/missions/${missionId}/tasks`);
      if (!res.ok) return;
      const { tasks } = await res.json();
      missionsState.tasksByMission[missionId] = tasks;
    } catch { /* non-critical */ }
  }

  function onSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    ui.selectedMissionId = val || null;
    if (val) fetchTasks(val);
  }

  $effect(() => {
    if (ui.selectedMissionId) {
      fetchTasks(ui.selectedMissionId);
    }
  });
</script>

<div class="mission-bar">
  {#if missions.length === 0}
    <span class="no-missions">No missions</span>
  {:else}
    <label class="mission-label" for="mission-select">Mission</label>
    <select id="mission-select" class="mission-select" value={ui.selectedMissionId ?? ''} onchange={onSelect}>
      {#each missions as m (m.id)}
        <option value={m.id}>{m.title}</option>
      {/each}
    </select>
    <span class="mission-status">{missions.find(m => m.id === ui.selectedMissionId)?.status ?? ''}</span>
  {/if}
</div>

<style>
  .mission-bar {
    flex-shrink: 0;
    padding: 6px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mission-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text3);
  }
  .mission-select {
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
  .mission-select:focus { border-color: var(--accent); }
  .mission-status {
    font-size: 10px;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .no-missions {
    font-size: 11px;
    color: var(--text3);
    opacity: 0.6;
  }
</style>
