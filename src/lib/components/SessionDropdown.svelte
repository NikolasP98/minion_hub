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
    if (!sk) return '\u2014';
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

<div class="shrink-0 px-5 py-1.5 border-b border-border bg-bg2 flex items-center gap-2">
  <label class="text-[10px] font-bold uppercase tracking-[0.6px] text-muted-foreground" for="session-select">Session</label>
  <select
    id="session-select"
    class="flex-1 min-w-0 bg-bg3 border border-border rounded-[4px] text-foreground text-[11px] font-mono px-1.5 py-[3px] outline-none focus:border-accent"
    value={ui.selectedSessionKey ?? ''}
    onchange={onSelect}
  >
    {#each agentSessions as sess ((sess as { sessionKey?: string }).sessionKey)}
      {@const sk = (sess as { sessionKey?: string }).sessionKey ?? ''}
      <option value={sk}>{(sess as { label?: string }).label || truncKey(sk)}</option>
    {/each}
  </select>
  <span class="text-[10px] text-muted-foreground opacity-65">{agentSessions.length}</span>
</div>
