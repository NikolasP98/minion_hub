<script lang="ts">
  import { onMount } from 'svelte';
  import Topbar from '$lib/components/Topbar.svelte';
  import SessionsList from '$lib/components/SessionsList.svelte';
  import SessionViewer from '$lib/components/SessionViewer.svelte';
  import { hostsState, loadHosts } from '$lib/state/hosts.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import type { SessionRow } from '$lib/components/SessionsList.svelte';

  let hubSessions = $state<SessionRow[]>([]);
  let selectedKey = $state<string | null>(null);
  let loadingSessions = $state(false);

  async function loadSessions(serverId: string) {
    loadingSessions = true;
    try {
      const res = await fetch(`/api/servers/${serverId}/sessions`);
      if (!res.ok) return;
      const data = await res.json() as { sessions: SessionRow[] };
      hubSessions = Array.isArray(data.sessions) ? data.sessions : [];
    } catch {
      // non-critical
    } finally {
      loadingSessions = false;
    }
  }

  onMount(() => {
    loadHosts();
    if (hostsState.activeHostId) {
      loadSessions(hostsState.activeHostId);
    }
  });

  // Re-load when active host changes
  $effect(() => {
    const id = hostsState.activeHostId;
    if (id) loadSessions(id);
  });

  // Merge hub DB sessions with live gateway sessions so sessions show
  // even before the gateway push has been deployed/run.
  const allSessions = $derived.by(() => {
    const map = new Map<string, SessionRow>();
    for (const s of hubSessions) {
      map.set(s.sessionKey, s);
    }
    for (const gwSession of gw.sessions) {
      const sk = gwSession.sessionKey;
      if (sk && !map.has(sk)) {
        const gs = gwSession as Record<string, unknown>;
        map.set(sk, {
          id: sk,
          serverId: hostsState.activeHostId ?? '',
          agentId: (gs.agentId as string) ?? 'default',
          sessionKey: sk,
          status: (gs.status as string) ?? 'idle',
          metadata: null,
          createdAt: (gs.createdAt as number) ?? 0,
          updatedAt: (gs.lastActiveAt as number) ?? (gs.updatedAt as number) ?? Date.now(),
        });
      }
    }
    return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  });

  const selectedSession = $derived(
    allSessions.find((s) => s.sessionKey === selectedKey) ?? null
  );
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
  <Topbar />
  <div class="flex-1 min-h-0 flex overflow-hidden">
    <!-- Left panel: session list -->
    <div class="w-[300px] shrink-0 border-r border-border flex flex-col overflow-hidden relative">
      {#if loadingSessions}
        <div class="absolute top-0 left-0 right-0 h-[2px] bg-border z-10 overflow-hidden">
          <div class="h-full w-[40%] bg-accent rounded-sm animate-loading-slide"></div>
        </div>
      {/if}
      <SessionsList
        sessions={allSessions}
        {selectedKey}
        onSelect={(k) => (selectedKey = k)}
      />
    </div>

    <!-- Right panel: session viewer -->
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      <SessionViewer
        serverId={hostsState.activeHostId}
        sessionKey={selectedKey}
        session={selectedSession}
      />
    </div>
  </div>
</div>
