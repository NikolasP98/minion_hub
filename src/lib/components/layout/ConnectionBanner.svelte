<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { getActiveHost } from '$lib/state/features/hosts.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { isUpdateRestartExpected } from '$lib/state/gateway/update-state.svelte';
  import { restartState } from '$lib/state/config/config.svelte';
  import { Spinner } from '$lib/components/ui';
  import { AlertTriangle, RotateCw, Settings2 } from 'lucide-svelte';

  const activeHost = $derived(getActiveHost());

  // Only surface when we have a host we're supposed to be connected to, but aren't.
  // A persistent banner (not a toast): the condition lasts until it resolves.
  const show = $derived(!!activeHost && !conn.connected);
  // The disconnect is the EXPECTED restart step of an update install or a
  // config-save restart — show a calm amber "updating/restarting" line instead
  // of the red outage banner. Red stays for unexpected disconnects.
  //
  // isUpdateRestartExpected() is client-module state and dies on a hard reload
  // or when the update was started from another tab — so while disconnected we
  // ALSO ask the server whether a fleet update job is active (round-6): any
  // connection failure during an active rollout stays amber, never red.
  let fleetUpdateActive = $state(false);
  $effect(() => {
    if (!show) {
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
    isUpdateRestartExpected() || restartState.phase === 'restarting' || fleetUpdateActive,
  );
  const reconnecting = $derived(conn.connecting);

  let showDetail = $state(false);

  function retry() {
    void wsConnect();
  }
  function manageHosts() {
    ui.overlayOpen = true;
  }
</script>

{#if show}
  <div
    class="shrink-0 flex flex-col gap-1.5 px-4 md:pr-44 py-2 text-xs border-b
      {reconnecting || expectedRestart
        ? 'bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] border-[color-mix(in_srgb,var(--color-warning)_25%,transparent)] text-warning'
        : 'bg-[color-mix(in_srgb,var(--color-destructive)_12%,transparent)] border-[color-mix(in_srgb,var(--color-destructive)_25%,transparent)] text-destructive'}"
    role="status"
    aria-live="polite"
  >
    {#if expectedRestart}
      <div class="flex items-center gap-2.5">
        <Spinner size="xs" class="!text-warning shrink-0" />
        <span class="font-medium">
          {isUpdateRestartExpected() ? m.connectionBanner_updating() : m.config_gatewayRestarting()}
        </span>
      </div>
    {:else if reconnecting}
      <div class="flex items-center gap-2.5">
        <Spinner size="xs" class="!text-warning shrink-0" />
        <span class="font-medium">{m.connectionBanner_reconnecting({ host: activeHost?.name ?? '' })}</span>
      </div>
    {:else}
      <!-- Row 1: headline + raw-reason chip -->
      <div class="flex items-center gap-2.5 flex-wrap">
        <AlertTriangle size={14} class="shrink-0" />
        <span class="font-medium">{conn.connectError ?? m.connectionBanner_disconnected()}</span>
        {#if conn.connectErrorRaw}
          <button
            type="button"
            onclick={() => (showDetail = !showDetail)}
            class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 border border-destructive/25 text-destructive/70 hover:text-destructive transition-colors"
            title={m.a11y0_showRawReason()}
          >
            {conn.connectErrorRaw}
          </button>
        {/if}
      </div>

      <!-- Row 2: actionable hint + actions -->
      {#if conn.connectErrorHint}
        <div class="flex items-start gap-3 flex-wrap pl-[1.55rem]">
          <span class="text-destructive/80 leading-relaxed max-w-prose">{conn.connectErrorHint}</span>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onclick={retry}
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
            >
              <RotateCw size={11} /> {m.common_retry()}
            </button>
            {#if conn.connectErrorCta === 'hosts-edit'}
              <button
                type="button"
                onclick={manageHosts}
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Settings2 size={11} /> {m.connectionBanner_manageHosts()}
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="pl-[1.55rem]">
          <span class="text-destructive/80">{m.connectionBanner_retrying()}</span>
        </div>
      {/if}

      {#if showDetail && conn.connectErrorRaw}
        <div class="pl-[1.55rem] font-mono text-[10px] text-destructive/60">
          {m.connectionBanner_rawReason()}: <span class="text-destructive/80">{conn.connectErrorRaw}</span>
        </div>
      {/if}
    {/if}
  </div>
{/if}
