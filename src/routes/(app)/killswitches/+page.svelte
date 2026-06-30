<script lang="ts">
  import { Power, CircleCheck, TriangleAlert, ChevronDown, Radio, Megaphone, Clock } from 'lucide-svelte';
  import { Card, Badge, Button, EmptyState, PageHeader } from '$lib/components/ui';
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

<div class="mx-auto w-full max-w-6xl px-4 py-6">
  <PageHeader
    title="Kill Switches"
    subtitle="Owner-only runtime controls. Switches are live and reset to config defaults on gateway restart."
  >
    {#snippet leading()}<Power size={20} />{/snippet}
  </PageHeader>

  {#if !conn.connected}
    <EmptyState
      tone="neutral"
      title="Gateway not connected"
      description="Switch states are unknown until the gateway connects."
    />
  {:else if loading && !data}
    <p class="text-muted-foreground text-sm">Loading…</p>
  {:else if err && !data}
    <Card padding="lg">
      <div class="flex items-center justify-between gap-4">
        <p class="text-destructive text-sm">{err}</p>
        <Button variant="outline" size="sm" onclick={() => load()}>Retry</Button>
      </div>
    </Card>
  {:else if data}
    <!-- GLANCEABLE STATUS — answers "is everything live?" in one line -->
    {#if killed.length === 0}
      <div class="status-band live">
        <CircleCheck size={18} />
        <span class="font-medium">All systems live</span>
        <span class="text-muted-foreground">· {liveCount}/{real.length} active</span>
      </div>
    {:else}
      <div class="status-band off">
        <TriangleAlert size={18} class="shrink-0" />
        <span class="count">{killed.length} {killed.length === 1 ? 'switch' : 'switches'} off</span>
        <span class="off-names">· {killed.map((s) => s.label).join(', ')}</span>
      </div>
    {/if}

    <!-- MASTER — the hero. Hold the button to kill everything; tap to restore. -->
    <section
      class="master mt-4"
      class:master-killed={!masterLive}
    >
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
        <button
          type="button"
          class="group-head disclosure"
          aria-expanded={showFuture}
          onclick={() => (showFuture = !showFuture)}
        >
          <Clock size={13} />
          Not yet wired ({future.length})
          <ChevronDown size={14} class="chev {showFuture ? 'open' : ''}" />
        </button>
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
      <p class="text-destructive mt-4 text-sm">{err}</p>
    {/if}
  {/if}
</div>

<style>
  /* Glanceable status band */
  .status-band {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: var(--radius, 0.75rem);
    padding: 0.65rem 1rem;
    font-size: 0.875rem;
    border: 1px solid transparent;
  }
  .status-band.live {
    color: var(--color-success, #34d399);
    background: color-mix(in oklab, var(--color-success, #10b981) 10%, transparent);
    border-color: color-mix(in oklab, var(--color-success, #10b981) 25%, transparent);
  }
  .status-band.off {
    color: var(--color-warning, #f59e0b);
    background: color-mix(in oklab, var(--color-warning, #f59e0b) 12%, transparent);
    border-color: color-mix(in oklab, var(--color-warning, #f59e0b) 30%, transparent);
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
    color: var(--color-muted-foreground, #a1a1aa);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Master hero band */
  .master {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    border-radius: var(--radius-lg, 1rem);
    padding: 1.25rem 1.5rem;
    background: var(--color-card, #18181b);
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--color-success, #10b981) 28%, transparent),
      0 1px 2px rgb(0 0 0 / 0.3);
  }
  .master.master-killed {
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--color-destructive, #ef4444) 35%, transparent),
      0 1px 2px rgb(0 0 0 / 0.3);
  }

  /* Group headers */
  .group-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.75rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-muted-foreground, #a1a1aa);
  }
  .disclosure {
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
  }
  .disclosure :global(.chev) {
    transition: transform 200ms ease;
  }
  .disclosure :global(.chev.open) {
    transform: rotate(180deg);
  }

  /* Gallery grid */
  .gallery {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  @media (min-width: 640px) {
    .gallery {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  @media (min-width: 1024px) {
    .gallery {
      grid-template-columns: repeat(3, 1fr);
      gap: 1.25rem;
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
    gap: 0.85rem;
    border-radius: var(--radius-lg, 1rem);
    border: 1px solid var(--color-border, #27272a);
    background: var(--color-card, #18181b);
    padding: 1.5rem 1rem 1.25rem;
    text-align: center;
  }
  .tile.inert {
    opacity: 0.55;
    border-style: dashed;
  }
  .tile-label {
    font-size: 0.9rem;
    font-weight: 500;
    line-height: 1.2;
  }
  .tile-sub {
    font-size: 0.75rem;
    color: var(--color-muted-foreground, #a1a1aa);
    line-height: 1.2;
  }
</style>
