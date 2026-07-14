<script lang="ts">
  import { onMount } from 'svelte';
  import SessionsList from '$lib/components/sessions/SessionsList.svelte';
  import SessionViewer from '$lib/components/sessions/SessionViewer.svelte';
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import type { SessionRow } from '$lib/components/sessions/SessionsList.svelte';
  import { Button, PageHeader } from '$lib/components/ui';
  import {
    AsyncBoundary,
    PageBody,
    PageShell,
    type AsyncBoundaryState,
  } from '$lib/components/ui/foundations';
  import { ApiError, fetchJson } from '$lib/api/fetch-json';
  import { ArrowLeft } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let hubSessions = $state<SessionRow[]>([]);
  let selectedKey = $state<string | null>(null);
  let loadingSessions = $state(false);
  let sessionsError = $state<ApiError | Error | null>(null);

  async function loadSessions(serverId: string) {
    loadingSessions = true;
    sessionsError = null;
    try {
      const data = await fetchJson<{ sessions: SessionRow[] }>(
        `/api/servers/${serverId}/sessions`,
      );
      hubSessions = Array.isArray(data.sessions) ? data.sessions : [];
    } catch (error) {
      sessionsError = error instanceof Error ? error : new Error(String(error));
    } finally {
      loadingSessions = false;
    }
  }

  onMount(() => {
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
        const gs = gwSession as unknown as Record<string, unknown>;
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

  const listState = $derived.by<AsyncBoundaryState>(() => {
    if (loadingSessions && allSessions.length === 0) {
      return { kind: 'loading', label: m.common_loading() };
    }
    if (sessionsError && allSessions.length === 0) {
      if (sessionsError instanceof ApiError && sessionsError.kind === 'forbidden') {
        return { kind: 'forbidden', description: sessionsError.message };
      }
      if (
        sessionsError instanceof ApiError &&
        (sessionsError.kind === 'network' || sessionsError.kind === 'unavailable')
      ) {
        return {
          kind: 'unavailable',
          title: m.common_error(),
          description: sessionsError.message,
          retry: () => {
            if (hostsState.activeHostId) void loadSessions(hostsState.activeHostId);
          },
        };
      }
      return {
        kind: 'error',
        description: sessionsError.message,
        retry: () => {
          if (hostsState.activeHostId) void loadSessions(hostsState.activeHostId);
        },
      };
    }
    if (allSessions.length === 0) {
      return { kind: 'empty', title: m.sessions_noSessions() };
    }
    return { kind: 'ready' };
  });
</script>

<!-- This route is an explicit fixed-height master/detail workspace. The shell
     provides the definite block size; list and transcript own their scrolling. -->
<PageShell archetype="master-detail" scroll="none" labelledBy="sessions-title">
  <PageHeader
    titleId="sessions-title"
    title={m.breadcrumb_sessions()}
    subtitle={m.sessions_selectToView()}
    sticky={false}
  />
  <PageBody padding="none" scroll="none">
  <div
    data-component="sessions-master-detail"
    data-has-selection={selectedKey ? 'true' : 'false'}
    class="sessions-layout flex-1 min-h-0 overflow-hidden"
  >
    <!-- Left panel: session list -->
    <div data-part="master" class="sessions-master shrink-0 border-r border-border flex flex-col overflow-hidden relative">
      {#if loadingSessions}
        <div class="absolute top-0 left-0 right-0 h-[2px] bg-border z-[var(--layer-sticky,10)] overflow-hidden">
          <div class="h-full w-[40%] bg-accent rounded-sm animate-loading-slide"></div>
        </div>
      {/if}
      <AsyncBoundary state={listState} compact class="h-full">
        <SessionsList
          sessions={allSessions}
          {selectedKey}
          onSelect={(k) => (selectedKey = k)}
        />
      </AsyncBoundary>
    </div>

    <!-- Right panel: session viewer -->
    <div data-part="detail" class="sessions-detail flex-1 min-w-0 flex flex-col overflow-hidden">
      <div class="sessions-back shrink-0 border-b border-border p-2">
        <Button variant="ghost" size="sm" onclick={() => (selectedKey = null)}>
          <ArrowLeft size={16} /> {m.common_back()}
        </Button>
      </div>
      <SessionViewer
        serverId={hostsState.activeHostId}
        sessionKey={selectedKey}
        session={selectedSession}
      />
    </div>
  </div>
  </PageBody>
</PageShell>

<style>
  .sessions-layout {
    display: flex;
  }
  .sessions-master {
    width: 300px;
  }
  .sessions-back {
    display: none;
  }
  @media (max-width: 767.98px) {
    .sessions-master {
      width: 100%;
      border-right: 0;
    }
    .sessions-detail {
      display: none;
    }
    [data-has-selection='true'] .sessions-master {
      display: none;
    }
    [data-has-selection='true'] .sessions-detail,
    [data-has-selection='true'] .sessions-back {
      display: flex;
    }
  }
  @media (min-width: 768px) and (max-width: 1279.98px) {
    .sessions-master {
      width: 280px;
    }
  }
</style>
