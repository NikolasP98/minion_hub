<script lang="ts">
  import { Button } from '$lib/components/ui';
  import KpiRow from './KpiRow.svelte';
  import { onMount, untrack } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    Puzzle,
    Activity,
    AlertCircle,
    Wrench,
    Webhook,
    Radio,
    Cpu,
    Code2,
    Workflow,
    Clock,
    CircleAlert,
    EyeOff,
    Eye,
    TrendingDown,
  } from 'lucide-svelte';
  import {
    createPluginHealthState,
    type PluginHealthEntry,
  } from '$lib/state/reliability/plugin-health.svelte';
  import {
    subscribeReliabilityLive,
    type ReliabilityEvent,
  } from '$lib/state/reliability/reliability.svelte';
  import { captureGatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
  import { createReliabilityLiveRefresh } from '$lib/state/reliability/live-refresh';
  import { matchReliabilityViewOwner } from '$lib/state/reliability/view-owner';
  import ReliabilityReadBoundary from './ReliabilityReadBoundary.svelte';
  import { reliabilityReadBoundary } from './read-boundary';

  interface Props {
    serverId: string;
    actorId: string | null | undefined;
    orgId: string | null | undefined;
    hostUrl: string | null | undefined;
    from: number;
    to: number;
  }

  let { serverId, actorId, orgId, hostUrl, from, to }: Props = $props();

  const queryKey = () => JSON.stringify([actorId, orgId, hostUrl, serverId, from, to]);
  const health = createPluginHealthState(() =>
    matchReliabilityViewOwner(captureGatewaySessionOwner(), () => ({
      actorId,
      orgId,
      hostId: serverId,
      hostUrl,
      queryKey: queryKey(),
    })),
  );
  let snap = $derived(health.snapshot);
  function retryPluginHealth() {
    void refresh?.run();
  }
  const readState = $derived(
    reliabilityReadBoundary(health.status, snap !== null, retryPluginHealth, {
      failedTitle: m.reliability_resourceFailed({ resource: m.reliability_pluginTitle() }),
      unavailableTitle: m.reliability_resourceUnavailable({
        resource: m.reliability_pluginTitle(),
      }),
      failedDescription: m.reliability_lastSuccessful(),
      unavailableDescription: m.reliability_readUnavailable(),
      unsupportedDescription: m.reliability_sampleOnly(),
    }),
  );

  // ── Disabled-plugin visibility (hidden by default) ────────────────────────
  let showDisabled = $state(false);
  let disabledCount = $derived((snap?.plugins ?? []).filter((p) => p.status === 'disabled').length);
  let visiblePlugins = $derived.by(() => {
    const all = snap?.plugins ?? [];
    return showDisabled ? all : all.filter((p) => p.status !== 'disabled');
  });

  // ── Live activity (driven off the gateway WS event stream) ────────────────
  // Attribute each incoming live event to a plugin the same way the gateway
  // RPC does (metadata.pluginId → event-type prefix / metadata.channelId), then
  // flash that plugin's "live" indicator and request one coalesced fresh
  // snapshot. Live samples never change aggregate snapshot arithmetic.
  const ACTIVE_WINDOW_MS = 2500;
  let liveActivity = $state(new Map<string, number>()); // pluginId → last live event ts
  let now = $state(Date.now());
  let mounted = false;
  let visible = true;
  let refresh: ReturnType<typeof createReliabilityLiveRefresh> | null = null;

  let prefixOwner = $derived.by(() => {
    const map = new Map<string, string>();
    for (const p of snap?.plugins ?? []) {
      const claim = (k: string) => {
        if (k && !map.has(k)) map.set(k, p.pluginId);
      };
      claim(p.pluginId);
      for (const c of p.channelIds) claim(c);
      for (const pr of p.providerIds) claim(pr);
    }
    return map;
  });

  function eventType(ev: string): string {
    const d = ev.indexOf('.');
    return d === -1 ? ev : ev.slice(0, d);
  }

  function attributeLive(ev: ReliabilityEvent): string | undefined {
    const md = ev.metadata ?? {};
    if (typeof md.pluginId === 'string') return md.pluginId;
    const owner = prefixOwner.get(eventType(ev.event));
    if (owner) return owner;
    return typeof md.channelId === 'string' ? prefixOwner.get(md.channelId) : undefined;
  }

  // Query/owner changes retire the prior coalescer immediately so the new read
  // never waits behind an abandoned transport.
  $effect(() => {
    const key = queryKey();
    untrack(() => {
      refresh?.dispose();
      refresh = createReliabilityLiveRefresh({
        current: () => mounted && visible && queryKey() === key,
        refresh: () => health.load(serverId, from, to),
      });
      liveActivity = new Map();
      if (mounted && visible) void refresh.run();
    });
  });

  // A fresh snapshot removes activity entries for plugins that are no longer
  // installed without triggering another transport read.
  $effect(() => {
    const installed = new Set((snap?.plugins ?? []).map((plugin) => plugin.pluginId));
    untrack(() => {
      liveActivity = new Map([...liveActivity].filter(([pluginId]) => installed.has(pluginId)));
    });
  });

  function handleLive(
    eventOwner: ReturnType<typeof captureGatewaySessionOwner>,
    event: ReliabilityEvent,
  ) {
    const currentOwner = matchReliabilityViewOwner(captureGatewaySessionOwner(), () => ({
      actorId,
      orgId,
      hostId: serverId,
      hostUrl,
      queryKey: queryKey(),
    }));
    if (
      !eventOwner ||
      !currentOwner ||
      eventOwner.token !== currentOwner.token ||
      !currentOwner.current()
    )
      return;
    if (event.timestamp < from || event.timestamp > to) return;
    const pluginId = attributeLive(event);
    if (!pluginId || !snap?.plugins.some((plugin) => plugin.pluginId === pluginId)) return;
    liveActivity = new Map(liveActivity).set(pluginId, event.timestamp);
    refresh?.notify();
  }

  // ── Summary across all installed plugins ──────────────────────────────────
  let summary = $derived.by(() => {
    const plugins = snap?.plugins ?? [];
    let loaded = 0;
    let errored = 0;
    let disabled = 0;
    let events = 0;
    let errors = 0;
    for (const p of plugins) {
      if (p.status === 'loaded') loaded++;
      else if (p.status === 'error') errored++;
      else disabled++;
      events += p.telemetry.totalEvents;
      errors += p.telemetry.errors;
    }
    return { total: plugins.length, loaded, errored, disabled, events, errors };
  });

  // Fleet-of-plugins health row — the one-glance summary the other reliability
  // tabs have, above the per-plugin sections. Static reads (no hover detail).
  let pluginKpis = $derived.by(() => {
    const s = summary;
    const errRate = s.events > 0 ? (s.errors / s.events) * 100 : null;
    return [
      {
        key: 'loaded',
        Icon: Puzzle,
        color: 'var(--color-success)',
        label: m.reliability_pluginKpiLoaded(),
        value: `${s.loaded}/${s.total}`,
      },
      {
        key: 'errored',
        Icon: CircleAlert,
        color: s.errored > 0 ? 'var(--color-destructive)' : 'var(--color-muted-foreground)',
        label: m.reliability_pluginKpiErrored(),
        value: s.errored,
      },
      {
        key: 'disabled',
        Icon: EyeOff,
        color: 'var(--color-muted-foreground)',
        label: m.reliability_pluginKpiDisabled(),
        value: s.disabled,
      },
      {
        key: 'events',
        Icon: Activity,
        color: 'var(--color-accent)',
        label: m.reliability_capEvents(),
        value: formatNumber(s.events),
      },
      {
        key: 'errors',
        Icon: AlertCircle,
        color: s.errors > 0 ? 'var(--color-destructive)' : 'var(--color-muted-foreground)',
        label: m.reliability_capErrors(),
        value: formatNumber(s.errors),
      },
      {
        key: 'errRate',
        Icon: TrendingDown,
        color:
          errRate === null
            ? 'var(--color-muted-foreground)'
            : errRate < 1
              ? 'var(--color-success)'
              : errRate < 5
                ? 'var(--color-warning)'
                : 'var(--color-destructive)',
        label: m.reliability_pluginKpiErrRate(),
        value: errRate === null ? '—' : errRate.toFixed(1),
        unit: errRate === null ? '' : '%',
      },
    ];
  });

  function statusColor(status: string): string {
    switch (status) {
      case 'loaded':
        return 'var(--color-success)';
      case 'error':
        return 'var(--color-destructive)';
      default:
        return 'var(--color-muted-foreground)';
    }
  }

  function statusBadgeClass(status: string): string {
    switch (status) {
      case 'loaded':
        return 'bg-success/15 text-success';
      case 'error':
        return 'bg-destructive/15 text-destructive';
      default:
        return 'bg-bg3 text-muted-foreground';
    }
  }

  function originBadgeClass(origin: string): string {
    switch (origin) {
      case 'bundled':
        return 'bg-accent/10 text-accent';
      case 'workspace':
        return 'bg-accent/15 text-accent';
      case 'global':
        return 'bg-info/15 text-info';
      default:
        return 'bg-bg3 text-muted-foreground';
    }
  }

  function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
  }

  function relTime(ts: number | null): string {
    if (ts == null) return m.reliability_pluginNoActivity();
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    const mn = Math.floor(s / 60);
    const h = Math.floor(mn / 60);
    const d = Math.floor(h / 24);
    if (s < 60) return `${s}s`;
    if (mn < 60) return `${mn}m`;
    if (h < 24) return `${h}h`;
    return `${d}d`;
  }

  // Per-plugin KPI tiles: always-visible reliability metrics + the plugin's
  // declared capability counts (only the non-trivial dimensions per plugin).
  type Kpi = {
    key: string;
    Icon: typeof Activity;
    label: string;
    value: number;
    color: string;
    danger?: boolean;
  };

  function kpis(p: PluginHealthEntry): Kpi[] {
    const c = p.capabilities;
    const t = p.telemetry;
    const out: Kpi[] = [
      {
        key: 'events',
        Icon: Activity,
        label: m.reliability_capEvents(),
        value: t.totalEvents,
        color: 'var(--color-accent)',
      },
      {
        key: 'errors',
        Icon: AlertCircle,
        label: m.reliability_capErrors(),
        value: t.errors,
        color: 'var(--color-destructive)',
        danger: t.errors > 0,
      },
      {
        key: 'tools',
        Icon: Wrench,
        label: m.reliability_capTools(),
        value: c.tools,
        color: 'var(--color-purple)',
      },
      {
        key: 'hooks',
        Icon: Webhook,
        label: m.reliability_capHooks(),
        value: c.hooks,
        color: 'var(--color-cyan)',
      },
      {
        key: 'channels',
        Icon: Radio,
        label: m.reliability_capChannels(),
        value: c.channels,
        color: 'var(--color-warning)',
      },
      {
        key: 'providers',
        Icon: Cpu,
        label: m.reliability_capProviders(),
        value: c.providers,
        color: 'var(--color-success)',
      },
      {
        key: 'methods',
        Icon: Code2,
        label: m.reliability_capMethods(),
        value: c.gatewayMethods,
        color: 'var(--color-info)',
      },
      {
        key: 'flows',
        Icon: Workflow,
        label: m.reliability_capFlows(),
        value: c.flows + c.flowNodes,
        color: 'var(--color-pink)',
      },
    ];
    return out;
  }

  // Poll only while this mounted panel is visible. Initial/query/live/manual
  // refreshes share the current query's one-active/one-trailing controller.
  onMount(() => {
    mounted = true;
    visible = document.visibilityState !== 'hidden';
    const onVisibility = () => {
      visible = document.visibilityState !== 'hidden';
      if (visible) void refresh?.run();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribeLive = subscribeReliabilityLive((eventOwner, event) =>
      untrack(() => handleLive(eventOwner, event)),
    );
    void refresh?.run();
    const interval = setInterval(() => {
      if (visible) void refresh?.run();
    }, 60_000);
    // 1s tick so the live-activity pulse expires after ACTIVE_WINDOW_MS.
    const tick = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
      clearInterval(tick);
      unsubscribeLive();
      refresh?.dispose();
      refresh = null;
      health.reset();
      liveActivity = new Map();
    };
  });
</script>

<div class="flex flex-col gap-3">
  <!-- Section overview -->
  <div class="surface-2 rounded-lg px-4 py-3 flex items-center gap-4 flex-wrap">
    <div class="flex items-center gap-2">
      <Puzzle size={14} class="text-accent shrink-0" />
      <span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
        >{m.reliability_pluginTitle()}</span
      >
    </div>
    {#if snap}
      <span class="text-xs text-muted-foreground tabular-nums">
        {m.reliability_pluginsOverview({ loaded: summary.loaded, total: summary.total })}
      </span>
      {#if summary.errored > 0}
        <span class="text-xs text-destructive font-semibold tabular-nums"
          >{m.reliability_pluginFailed({ count: summary.errored })}</span
        >
      {/if}
      <span class="flex-1"></span>
      <span class="text-xs text-muted-strong tabular-nums">
        {formatNumber(summary.events)}
        {m.reliability_events()} · {formatNumber(summary.errors)}
        {m.reliability_capErrors().toLowerCase()}
      </span>
      {#if disabledCount > 0}
        <Button
          variant="outline"
          size="sm"
          type="button"
          class="shrink-0"
          aria-expanded={showDisabled}
          onclick={() => (showDisabled = !showDisabled)}
        >
          {#if showDisabled}
            <EyeOff size={11} class="shrink-0" />
            {m.reliability_pluginHideDisabled()}
          {:else}
            <Eye size={11} class="shrink-0" />
            {m.reliability_pluginShowDisabled({ count: disabledCount })}
          {/if}
        </Button>
      {/if}
    {/if}
  </div>

  <!-- Fleet-of-plugins health row (one-glance summary, like the other tabs). -->
  {#if snap}
    <KpiRow items={pluginKpis} cols={6} />
  {/if}

  {#if readState && (!snap || readState.kind !== 'ready')}
    <ReliabilityReadBoundary state={readState} compact={snap !== null} />
  {/if}
  {#if snap}
    {#if visiblePlugins.length === 0}
      <div
        class="surface-2 rounded-lg flex items-center justify-center py-12 text-muted-foreground text-sm"
      >
        {m.reliability_noPlugins()}
      </div>
    {:else}
      <!-- One section per installed plugin -->
      {#each visiblePlugins as plugin (plugin.pluginId)}
        {@const active = now - (liveActivity.get(plugin.pluginId) ?? 0) < ACTIVE_WINDOW_MS}
        <div
          class="surface-2 rounded-lg overflow-hidden transition-shadow {active
            ? 'ring-1 ring-success/40'
            : ''}"
        >
          <!-- Status accent stripe -->
          <div class="h-[2px] w-full" style:background={statusColor(plugin.status)}></div>

          <!-- Header -->
          <div class="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-border">
            <span
              class="w-2 h-2 rounded-full shrink-0"
              style:background={statusColor(plugin.status)}
            ></span>
            <span class="text-sm font-semibold text-foreground">{plugin.name}</span>
            {#if plugin.name !== plugin.pluginId}
              <span class="text-xs text-muted-strong font-mono">{plugin.pluginId}</span>
            {/if}
            {#if plugin.version}
              <span class="text-xs text-muted-strong tabular-nums">v{plugin.version}</span>
            {/if}
            <span
              class="text-xs font-semibold px-1.5 py-0.5 rounded-sm uppercase tracking-wide {originBadgeClass(
                plugin.origin,
              )}"
            >
              {plugin.origin}
            </span>
            <span
              class="text-xs font-semibold px-1.5 py-0.5 rounded-sm uppercase tracking-wide {statusBadgeClass(
                plugin.status,
              )}"
            >
              {plugin.status}
            </span>
            {#if !plugin.configEnabled}
              <span
                class="text-xs font-semibold px-1.5 py-0.5 rounded-sm uppercase tracking-wide bg-bg3 text-muted-foreground"
              >
                {m.reliability_pluginDisabled()}
              </span>
            {/if}
            <!-- Live activity indicator -->
            {#if active}
              <span
                class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success"
              >
                <span class="relative flex h-2 w-2">
                  <span
                    class="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"
                  ></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                {m.reliability_pluginLive()}
              </span>
            {/if}
            <span class="flex-1"></span>
            <span
              class="flex items-center gap-1 text-xs tabular-nums {active
                ? 'text-success'
                : 'text-muted-strong'}"
              title={m.reliability_pluginLastActivity()}
            >
              <Clock size={10} class="shrink-0" />
              {active ? m.reliability_pluginNow() : relTime(plugin.telemetry.lastActivityAt)}
            </span>
          </div>

          <!-- KPI widget grid -->
          <div
            class="grid grid-cols-8 divide-x divide-border/60 max-[1100px]:grid-cols-4 max-[640px]:grid-cols-2"
          >
            {#each kpis(plugin) as kpi (kpi.key)}
              {@const Icon = kpi.Icon}
              {@const flashing = kpi.key === 'events' && active}
              <div class="px-3 py-2.5 flex flex-col gap-1">
                <div class="flex items-center gap-1">
                  <span
                    style:color={kpi.danger ? 'var(--color-destructive)' : kpi.color}
                    class="shrink-0 flex"><Icon size={9} /></span
                  >
                  <span
                    class="text-xs font-semibold text-muted-foreground uppercase tracking-widest truncate"
                    >{kpi.label}</span
                  >
                </div>
                <span
                  class="text-2xl font-bold font-mono tabular-nums leading-none transition-colors {flashing
                    ? 'text-success'
                    : ''}"
                  style:color={flashing
                    ? undefined
                    : kpi.value === 0
                      ? 'var(--color-muted-strong)'
                      : kpi.danger
                        ? 'var(--color-destructive)'
                        : kpi.color}
                >
                  {formatNumber(kpi.value)}
                </span>
              </div>
            {/each}
          </div>

          <!-- Error detail -->
          {#if plugin.status === 'error' && plugin.error}
            <div class="flex items-start gap-2 px-4 py-2 border-t border-border bg-destructive/5">
              <CircleAlert size={12} class="text-destructive shrink-0 mt-0.5" />
              <span class="text-xs text-destructive break-words">{plugin.error}</span>
            </div>
          {:else if plugin.telemetry.lastError}
            <div class="flex items-start gap-2 px-4 py-2 border-t border-border">
              <CircleAlert size={12} class="text-warning shrink-0 mt-0.5" />
              <div class="min-w-0">
                <span class="text-xs font-mono text-warning"
                  >{plugin.telemetry.lastError.event}</span
                >
                <span class="text-xs text-muted-foreground break-words"
                  >— {plugin.telemetry.lastError.message}</span
                >
              </div>
            </div>
          {/if}

          <!-- Top failure modes + capability chips -->
          {#if plugin.telemetry.topFailureModes.length > 0 || plugin.channelIds.length > 0 || plugin.providerIds.length > 0}
            <div
              class="flex items-center gap-x-4 gap-y-1.5 flex-wrap px-4 py-2 border-t border-border"
            >
              {#if plugin.telemetry.topFailureModes.length > 0}
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-xs font-semibold uppercase tracking-widest text-muted-strong"
                    >{m.reliability_pluginTopModes()}</span
                  >
                  {#each plugin.telemetry.topFailureModes as mode (mode.event)}
                    <span
                      class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-bg3 border border-border"
                    >
                      <span class="font-mono text-foreground">{mode.failureMode}</span>
                      <span class="text-muted-strong tabular-nums">{formatNumber(mode.count)}</span>
                    </span>
                  {/each}
                </div>
              {/if}
              {#if plugin.channelIds.length > 0}
                <div class="flex items-center gap-1.5 flex-wrap">
                  <Radio size={10} class="text-warning shrink-0" />
                  {#each plugin.channelIds as ch (ch)}
                    <span class="text-xs px-1.5 py-0.5 rounded-md bg-warning/10 text-warning"
                      >{ch}</span
                    >
                  {/each}
                </div>
              {/if}
              {#if plugin.providerIds.length > 0}
                <div class="flex items-center gap-1.5 flex-wrap">
                  <Cpu size={10} class="text-success shrink-0" />
                  {#each plugin.providerIds as pr (pr)}
                    <span class="text-xs px-1.5 py-0.5 rounded-md bg-success/10 text-success"
                      >{pr}</span
                    >
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  {/if}
</div>
