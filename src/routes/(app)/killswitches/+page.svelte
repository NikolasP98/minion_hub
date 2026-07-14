<script lang="ts">
  import {
    Power,
    CircleCheck,
    TriangleAlert,
    ChevronDown,
    Radio,
    Megaphone,
    Clock,
  } from 'lucide-svelte';
  import { Badge, Button, PageHeader } from '$lib/components/ui';
  import {
    AsyncBoundary,
    PageBody,
    PageShell,
    type AsyncBoundaryState,
  } from '$lib/components/ui/foundations';
  import { sendRequest } from '$lib/services/gateway-rpc';
  import { conn } from '$lib/state/gateway';
  import PowerSwitch from './PowerSwitch.svelte';

  type Group = 'core' | 'channels' | 'future';
  type KillSwitch = {
    id: string;
    label: string;
    group: Group;
    enabled: boolean;
    available: boolean;
    description?: string;
  };
  type ListResp = {
    master: { id: string; label: string; enabled: boolean };
    switches: KillSwitch[];
  };

  let data = $state<ListResp | null>(null);
  let loading = $state(false);
  let err = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let showFuture = $state(false);
  // Load once the gateway WS is connected, and re-load on reconnect. onMount
  // fires before the handshake completes → a mount-time call rejects with
  // "not connected" and would never retry.
  let loadedForConn = $state(false);

  // Channels lead Core: by blast radius, the human-facing surface matters most.
  const channels = $derived(data?.switches.filter((s) => s.group === 'channels') ?? []);
  const core = $derived(data?.switches.filter((s) => s.group === 'core') ?? []);
  const future = $derived(data?.switches.filter((s) => s.group === 'future') ?? []);
  const masterLive = $derived(data?.master.enabled ?? false);

  // Glanceable summary over the real (available) switches.
  const real = $derived(data?.switches.filter((s) => s.available) ?? []);
  const liveCount = $derived(real.filter((s) => s.enabled).length);
  const killed = $derived(real.filter((s) => !s.enabled));
  const loadState = $derived.by<AsyncBoundaryState>(() => {
    if (!conn.connected) {
      return {
        kind: 'unavailable',
        title: 'Gateway not connected',
        description: 'Switch states are unknown until the gateway connects.',
      };
    }
    if (loading && !data) return { kind: 'loading', label: 'Loading kill switches' };
    if (err && !data) return { kind: 'error', description: err, retry: () => void load() };
    return { kind: 'ready' };
  });

  async function load() {
    loading = true;
    err = null;
    try {
      data = (await sendRequest('killswitch.list', {})) as ListResp;
    } catch (e) {
      err = e instanceof Error ? e.message : 'Failed to load kill switches';
    } finally {
      loading = false;
    }
  }

  async function setSwitch(id: string, enabled: boolean) {
    busy = id;
    try {
      data = (await sendRequest('killswitch.set', { id, enabled })) as ListResp;
    } catch (e) {
      err = e instanceof Error ? e.message : 'Action failed';
    } finally {
      busy = null;
    }
  }

  $effect(() => {
    if (conn.connected) {
      if (!loadedForConn) {
        loadedForConn = true;
        void load();
      }
    } else {
      loadedForConn = false; // reset so we reload after a reconnect
    }
  });
</script>

<svelte:head><title>Kill Switches · Minion hub</title></svelte:head>

<PageShell archetype="collection" scroll="page" labelledBy="killswitches-title">
  <PageHeader
    titleId="killswitches-title"
    title="Kill Switches"
    subtitle="Owner-only runtime controls. Switches are live and reset to config defaults on gateway restart."
  >
    {#snippet leading()}<Power size={20} />{/snippet}
  </PageHeader>

  <PageBody width="content">
    <AsyncBoundary state={loadState}>
      {#if data}
        <!-- GLANCEABLE STATUS — answers "is everything live?" in one line -->
        {#if killed.length === 0}
          <div class="status-band live" role="status">
            <CircleCheck size={18} />
            <span class="font-medium">All systems live</span>
            <span class="text-muted-foreground">· {liveCount}/{real.length} active</span>
          </div>
        {:else}
          <div class="status-band off" role="status">
            <TriangleAlert size={18} class="shrink-0" />
            <span class="count"
              >{killed.length} {killed.length === 1 ? 'switch' : 'switches'} off</span
            >
            <span class="off-names">· {killed.map((s) => s.label).join(', ')}</span>
          </div>
        {/if}

        <!-- MASTER — the hero. Hold the button to kill everything; tap to restore. -->
        <section class="master mt-4" class:master-killed={!masterLive}>
          <PowerSwitch
            size="lg"
            live={masterLive}
            busy={busy === 'master'}
            holdToKill
            label="Master — all systems"
            onactivate={(next) => setSwitch('master', next)}
          />
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="text-lg font-semibold">Master</h2>
              <Badge variant="semantic" value={masterLive ? 'success' : 'error'}>
                {masterLive ? 'System live' : 'System killed'}
              </Badge>
            </div>
            <p class="text-muted-foreground mt-0.5 text-sm">
              {#if masterLive}
                Cuts <strong class="text-foreground">all channels, TTS &amp; heartbeats</strong> at once.
                Hold the button to confirm.
              {:else}
                System is killed — channels, TTS and heartbeats are stopped. Press to restore.
              {/if}
            </p>
          </div>
        </section>

        <!-- GALLERY: Channels first (blast radius), then Core -->
        {#each [['channels', 'Channels', Radio, channels], ['core', 'Core services', Megaphone, core]] as const as [g, heading, Icon, list] (g)}
          {#if list.length}
            <section class="mt-7">
              <div class="group-head">
                <Icon size={13} />{heading}
              </div>
              <div class="gallery">
                {#each list as s (s.id)}
                  <div class="tile">
                    <PowerSwitch
                      live={s.enabled}
                      busy={busy === s.id}
                      label={s.label}
                      onactivate={(next) => setSwitch(s.id, next)}
                    />
                    <div class="tile-label">{s.label}</div>
                    {#if s.description}<div class="tile-sub">{s.description}</div>{/if}
                  </div>
                {/each}
              </div>
            </section>
          {/if}
        {/each}

        <!-- FUTURE — collapsed by default; signposting, not daily status -->
        {#if future.length}
          <section class="mt-7">
            <Button
              variant="ghost"
              size="sm"
              class="group-head disclosure"
              aria-expanded={showFuture}
              onclick={() => (showFuture = !showFuture)}
            >
              <Clock size={13} />
              Not yet wired ({future.length})
              <ChevronDown size={14} class="chev {showFuture ? 'open' : ''}" />
            </Button>
            {#if showFuture}
              <div class="gallery">
                {#each future as s (s.id)}
                  <div class="tile inert">
                    <Badge class="absolute right-3 top-3">Soon</Badge>
                    <PowerSwitch live available={false} label={s.label} onactivate={() => {}} />
                    <div class="tile-label">{s.label}</div>
                    {#if s.description}<div class="tile-sub">{s.description}</div>{/if}
                  </div>
                {/each}
              </div>
            {/if}
          </section>
        {/if}

        {#if err}
          <p class="inline-error" role="alert">{err}</p>
        {/if}
      {/if}
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  /* Glanceable status band */
  .status-band {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    border-radius: var(--radius-lg);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    font-size: var(--font-size-body, 14px);
    border: 1px solid transparent;
  }
  .status-band.live {
    color: var(--color-success-fg, var(--color-success));
    background: var(--color-success-surface, transparent);
    border-color: var(--color-success-border, var(--color-success));
  }
  .status-band.off {
    color: var(--color-warning-fg, var(--color-warning));
    background: var(--color-warning-surface, transparent);
    border-color: var(--color-warning-border, var(--color-warning));
  }
  .status-band {
    flex-wrap: nowrap;
  }
  .status-band .count {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .off-names {
    flex: 1;
    min-width: 0;
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Master hero band */
  .master {
    display: flex;
    align-items: center;
    gap: var(--space-section);
    border: 1px solid var(--color-success-border, var(--color-success));
    border-radius: var(--radius-xl);
    padding: var(--space-section) var(--space-6, 24px);
    background: var(--color-surface-2, var(--elevation-2-bg));
    box-shadow: var(--shadow-sm);
  }
  .master.master-killed {
    border-color: var(--color-danger-border, var(--color-destructive));
  }

  /* Group headers */
  .group-head {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    margin-bottom: var(--space-3, 12px);
    font-size: var(--font-size-label, 12px);
    font-weight: var(--font-weight-semibold, 600);
    letter-spacing: var(--letter-spacing-label, 0.04em);
    text-transform: uppercase;
    color: var(--color-text-tertiary, var(--color-muted-foreground));
  }
  :global(.disclosure) {
    cursor: pointer;
    justify-content: flex-start;
  }
  :global(.disclosure .chev) {
    transition: transform var(--duration-normal) var(--ease-standard);
  }
  :global(.disclosure .chev.open) {
    transform: rotate(180deg);
  }

  /* Gallery grid */
  .gallery {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4, 16px);
  }
  @media (min-width: 640px) {
    .gallery {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  @media (min-width: 1024px) {
    .gallery {
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-section);
    }
  }
  @media (min-width: 1280px) {
    .gallery {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  /* Tile — kiosk front-panel: indicator button centered, label beneath */
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3, 12px);
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border-default, var(--color-border));
    background: var(--color-surface-2, var(--elevation-2-bg));
    padding: var(--space-6, 24px) var(--space-4, 16px) var(--space-section);
    text-align: center;
  }
  .tile.inert {
    opacity: 0.55;
    border-style: dashed;
  }
  .tile-label {
    font-size: var(--font-size-body, 14px);
    font-weight: var(--font-weight-medium, 500);
    line-height: var(--line-height-body, 20px);
  }
  .tile-sub {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    line-height: var(--line-height-compact, 16px);
  }
  .inline-error {
    margin-top: var(--space-4, 16px);
    color: var(--color-danger-fg, var(--color-destructive));
    font-size: var(--font-size-body, 14px);
    line-height: var(--line-height-body, 20px);
  }
  @media (max-width: 767.98px) {
    .master {
      align-items: flex-start;
      flex-direction: column;
      padding: var(--space-4, 16px);
    }
    .status-band {
      align-items: flex-start;
    }
    .off-names {
      white-space: normal;
    }
  }
</style>
