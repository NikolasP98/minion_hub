<script lang="ts">
  // The connection status dot + its hover popover. Replaces the old top-of-page
  // ConnectionBanner: the dot IS the persistent signal (green connected / amber
  // connecting-or-restarting / red error) and the popover carries the detail —
  // uptime when healthy, and the reconnecting/error content (with retry actions)
  // that used to live in the banner. Toasts are unchanged.
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { getActiveHost } from '$lib/state/features/hosts.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { isUpdateRestartExpected } from '$lib/state/gateway/update-state.svelte';
  import { restartState } from '$lib/state/config/restart.svelte';
  import { fmtTimeAgo, fmtUptime } from '$lib/utils/format';
  import { Button, Spinner } from '$lib/components/ui';
  import { AlertTriangle, RotateCw, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    popoverEnabled = true,
    open = $bindable(false),
  }: { popoverEnabled?: boolean; open?: boolean } = $props();

  const activeHost = $derived(getActiveHost());
  const connected = $derived(conn.connected);
  const reconnecting = $derived(conn.connecting);

  // A disconnect that IS the expected restart step of an update/config-save
  // stays amber, never red. isUpdateRestartExpected() is client-module state
  // that dies on a hard reload / cross-tab start, so while disconnected we also
  // ask the server whether a fleet update is active (mirrors the old banner).
  let fleetUpdateActive = $state(false);
  $effect(() => {
    if (connected) {
      fleetUpdateActive = false;
      return;
    }
    let cancelled = false;
    const check = () => {
      fetch('/api/gateway/fleet-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((view: { active?: boolean } | null) => {
          if (!cancelled) fleetUpdateActive = view?.active === true;
        })
        .catch(() => {});
    };
    check();
    const t = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  });

  const expectedRestart = $derived(
    !connected &&
      (isUpdateRestartExpected() || restartState.phase === 'restarting' || fleetUpdateActive),
  );

  // Three-state signal: green = connected, amber = connecting/restarting, red =
  // error/disconnected.
  type DotState = 'connected' | 'connecting' | 'error';
  const dotState = $derived<DotState>(
    connected ? 'connected' : reconnecting || expectedRestart ? 'connecting' : 'error',
  );
  const DOT_CLASS: Record<DotState, string> = {
    connected: 'bg-success text-success shadow-[var(--shadow-status-glow)]',
    connecting: 'bg-warning text-warning shadow-[var(--shadow-status-glow)] animate-pulse',
    error: 'bg-destructive text-destructive shadow-[var(--shadow-status-glow)] animate-pulse',
  };
  const STATUS_LABEL: Record<DotState, () => string> = {
    connected: () => 'Connected',
    connecting: () => (expectedRestart ? 'Restarting' : 'Reconnecting'),
    error: () => 'Disconnected',
  };
  const STATUS_TEXT_CLASS: Record<DotState, string> = {
    connected: 'text-success',
    connecting: 'text-warning',
    error: 'text-destructive',
  };

  const uptimeMs = $derived(
    gw.hello && conn.connectedAt
      ? (gw.hello.snapshot?.uptimeMs ?? 0) + (Date.now() - conn.connectedAt)
      : null,
  );

  const ariaLabel = $derived(`${activeHost?.name ?? 'No server'} — ${STATUS_LABEL[dotState]()}`);

  // Hover/focus popover with a small close grace so moving dot → panel across
  // the gap doesn't flicker it shut.
  let wantsOpen = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  function show() {
    clearTimeout(closeTimer);
    wantsOpen = true;
    if (popoverEnabled) open = true;
  }
  function hide() {
    wantsOpen = false;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => (open = false), 140);
  }

  function handleFocusOut(event: FocusEvent) {
    const wrapper = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget)) return;
    hide();
  }

  $effect(() => {
    if (!popoverEnabled) {
      open = false;
    } else if (wantsOpen) {
      open = true;
    }
  });

  function retry() {
    void wsConnect();
  }
  function manageHosts() {
    ui.overlayOpen = true;
  }
</script>

<div
  class="relative flex items-center"
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={handleFocusOut}
  role="presentation"
>
  <Button
    variant="ghost"
    size="xs"
    type="button"
    class="flex items-center justify-center w-4 h-4 -m-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
    aria-label={ariaLabel}
    aria-expanded={open}
  >
    <span class="w-1.5 h-1.5 rounded-full shrink-0 transition-colors {DOT_CLASS[dotState]}"></span>
  </Button>

  {#if open}
    <!-- Anchored to the dot, right-aligned so it grows to the LEFT of the chip
         section and drops just below the bar. -->
    <div
      class="absolute top-full right-0 mt-2 z-[9999] surface-3 rounded-[var(--radius-md)] shadow-lg
             w-[260px] p-3 space-y-2 text-xs text-foreground cursor-default"
      role="status"
      aria-live="polite"
      onmouseenter={show}
      onmouseleave={hide}
    >
      <!-- Header: host name + status word -->
      <div class="flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full shrink-0 {DOT_CLASS[dotState]}"></span>
        <span class="font-medium truncate">{activeHost?.name ?? 'No server connected'}</span>
        <span
          class="ml-auto text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-wide {STATUS_TEXT_CLASS[
            dotState
          ]}"
        >
          {STATUS_LABEL[dotState]()}
        </span>
      </div>

      {#if connected && uptimeMs != null}
        <div class="text-[length:var(--font-size-label)] text-muted-foreground">
          up {fmtUptime(uptimeMs)}
        </div>
      {:else if !connected && activeHost?.lastConnectedAt}
        <div class="text-[length:var(--font-size-label)] text-muted-foreground">
          last seen {fmtTimeAgo(activeHost.lastConnectedAt)}
        </div>
      {/if}

      {#if expectedRestart}
        <div
          class="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5
                 bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] text-warning"
        >
          <Spinner size="xs" class="!text-warning shrink-0" />
          <span class="font-medium">
            {isUpdateRestartExpected()
              ? m.connectionBanner_updating()
              : m.config_gatewayRestarting()}
          </span>
        </div>
      {:else if reconnecting}
        <div
          class="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5
                 bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] text-warning"
        >
          <Spinner size="xs" class="!text-warning shrink-0" />
          <span class="font-medium"
            >{m.connectionBanner_reconnecting({ host: activeHost?.name ?? '' })}</span
          >
        </div>
      {:else if !connected}
        <div
          class="rounded-[var(--radius-sm)] px-2 py-2 space-y-1.5
                 bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] text-destructive"
        >
          <div class="flex items-start gap-1.5">
            <AlertTriangle size={13} class="shrink-0 mt-0.5" />
            <span class="font-medium leading-snug"
              >{conn.connectError ?? m.connectionBanner_disconnected()}</span
            >
          </div>
          {#if conn.connectErrorHint}
            <p class="text-destructive/80 leading-relaxed pl-[var(--space-6)]">
              {conn.connectErrorHint}
            </p>
          {/if}
          {#if conn.connectErrorRaw}
            <p
              class="font-mono text-[length:var(--font-size-telemetry)] text-destructive/60 pl-[var(--space-6)] break-all"
            >
              {conn.connectErrorRaw}
            </p>
          {/if}
          <div class="flex items-center gap-1.5 pl-[var(--space-6)] pt-0.5">
            <Button
              variant="ghost"
              size="xs"
              type="button"
              onclick={retry}
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
            >
              <RotateCw size={11} />
              {m.common_retry()}
            </Button>
            {#if conn.connectErrorCta === 'hosts-edit'}
              <Button
                variant="ghost"
                size="xs"
                type="button"
                onclick={manageHosts}
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Settings2 size={11} />
                {m.connectionBanner_manageHosts()}
              </Button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
