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

<div class="shrink-0 px-5 py-1.5 border-b border-border flex items-center gap-2">
  {#if missions.length === 0}
    <span class="text-[11px] text-muted-foreground opacity-60">No missions</span>
  {:else}
    <label class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground" for="mission-select">Mission</label>
    <select
      id="mission-select"
      class="flex-1 min-w-0 bg-bg3 border border-border rounded-sm text-foreground text-[11px] font-mono px-1.5 py-[3px] outline-none focus:border-accent"
      value={ui.selectedMissionId ?? ''}
      onchange={onSelect}
    >
      {#each missions as m (m.id)}
        <option value={m.id}>{m.title}</option>
      {/each}
    </select>
    <span class="text-[10px] text-accent uppercase tracking-normal">{missions.find(m => m.id === ui.selectedMissionId)?.status ?? ''}</span>
  {/if}
</div>
