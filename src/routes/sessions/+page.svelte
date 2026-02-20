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

<div class="page">
  <Topbar />
  <div class="sessions-app" style="--sessions-left: 300px">
    <!-- Left panel: session list -->
    <div class="left-panel">
      {#if loadingSessions}
        <div class="loading-bar">
          <div class="loading-bar-inner"></div>
        </div>
      {/if}
      <SessionsList
        sessions={allSessions}
        {selectedKey}
        onSelect={(k) => (selectedKey = k)}
      />
    </div>

    <!-- Right panel: session viewer -->
    <div class="right-panel">
      <SessionViewer
        serverId={hostsState.activeHostId}
        sessionKey={selectedKey}
        session={selectedSession}
      />
    </div>
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .sessions-app {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .left-panel {
    width: var(--sessions-left, 300px);
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .right-panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .loading-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--border);
    z-index: 10;
    overflow: hidden;
  }
  .loading-bar-inner {
    height: 100%;
    width: 40%;
    background: var(--accent);
    border-radius: 2px;
    animation: loading-slide 1.2s ease-in-out infinite;
  }
  @keyframes loading-slide {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }
</style>
