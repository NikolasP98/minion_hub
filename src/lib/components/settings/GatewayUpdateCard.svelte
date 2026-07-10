<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { updateState, applyUpdateStatus, bumpUpdateProgress } from '$lib/state/gateway/update-state.svelte';
  import { configState, loadConfig, getField, beginRestart, restartState } from '$lib/state/config/config.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { PackageCheck, Download, RotateCw, AlertTriangle } from 'lucide-svelte';

  let checking = $state(false);
  let statusError = $state<string | null>(null);

  // 401/403 = the user lacks platform-admin rights (the route is admin-gated),
  // NOT a gateway connectivity problem — show the right copy for each.
  function isNoPermission(res: Response): boolean {
    return res.status === 401 || res.status === 403;
  }

  async function refreshStatus(): Promise<void> {
    try {
      const res = await fetch('/api/gateway/update');
      if (!res.ok) {
        statusError = isNoPermission(res)
          ? m.gateway_update_noPermission()
          : m.gateway_update_disconnected();
        return;
      }
      applyUpdateStatus(await res.json());
      statusError = null;
    } catch {
      statusError = m.gateway_update_disconnected();
    }
  }

  onMount(() => {
    void refreshStatus();
    // Notify targets live in gateway config — load it if some other page
    // hasn't already (mirrors the `conn.connected && !configState.loaded`
    // guard used throughout the hub, e.g. AgentSidebar.svelte).
    if (conn.connected && !configState.loaded && !configState.loading) {
      loadConfig().catch(() => {});
    }
  });

  async function checkNow() {
    if (checking) return;
    checking = true;
    try {
      const res = await fetch('/api/gateway/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'check' }),
      });
      if (isNoPermission(res)) {
        toastError(m.gateway_update_noPermission());
        return;
      }
      if (!res.ok) throw new Error('check failed');
      applyUpdateStatus(await res.json());
      statusError = null;
      if (!updateState.pending) toastSuccess(m.gateway_update_upToDate());
    } catch {
      toastError(m.gateway_update_checkFailed());
    } finally {
      checking = false;
    }
  }

  function failInstall(message: string) {
    updateState.installing = false;
    updateState.progress = null;
    toastError(message);
  }

  async function installNow() {
    if (!updateState.pending || updateState.installing) return;
    if (!confirm(m.gateway_update_confirmInstall({ version: updateState.pending.version }))) return;
    updateState.installing = true;
    updateState.progress = { phase: 'starting', pct: 5 };
    try {
      // The POST now long-polls through the npm install (40-120s). Real
      // progress arrives in parallel over the WS ('update.progress' events);
      // the response here is just the terminal signal for the install step.
      const res = await fetch('/api/gateway/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      });
      if (isNoPermission(res)) {
        failInstall(m.gateway_update_noPermission());
        return;
      }
      if (!res.ok) {
        // Explicit non-OK from the route = update.run itself errored (a
        // timeout/WS-drop after the run was dispatched comes back 200
        // {accepted:true}) — the only case that should read as failed.
        failInstall(m.gateway_update_installFailed());
        return;
      }
      const body = (await res.json()) as { ok?: boolean; accepted?: boolean };
      if (body.ok === false) {
        failInstall(m.gateway_update_installFailed());
        return;
      }
      bumpUpdateProgress(
        body.accepted ? { phase: 'installing', pct: 15 } : { phase: 'installed', pct: 70 },
      );
      // Gateway will drop the WS connection to restart — arm the same
      // restart machine the config-save flow uses (loading toast +
      // 30s reconnect timeout + reconnected toast). Skip if the update
      // already landed while the POST was in flight (pending cleared).
      if (updateState.pending) beginRestart();
    } catch {
      // Network hiccup between browser and hub AFTER the run may have been
      // dispatched — not an explicit failure. Let the restart machine plus
      // the 'update.applied' event / reconnect version check tell the story.
      bumpUpdateProgress({ phase: 'installing', pct: 15 });
      if (updateState.pending) beginRestart();
    }
  }

  const shortSha = $derived(gw.hello?.server?.commit?.slice(0, 7) ?? null);
  // update.status's `current` is the full timestamped version
  // (e.g. 2026.7.10-dev.20260710220841); hello.server.version can be a bare
  // channel tag ("dev") — only use it as a fallback.
  const currentVersion = $derived(updateState.current ?? gw.hello?.server?.version ?? null);
  const notifyTargets = $derived(
    (getField('update.notify') as { channel: string; to: string }[] | undefined) ?? [],
  );
  const installBusy = $derived(updateState.installing || restartState.phase === 'restarting');

  const PROGRESS_LABELS: Record<string, () => string> = {
    starting: m.gateway_update_phase_starting,
    installing: m.gateway_update_phase_installing,
    installed: m.gateway_update_phase_installed,
    'watchdog-armed': m.gateway_update_phase_watchdog,
    restarting: m.gateway_update_phase_restarting,
    done: m.gateway_update_phase_done,
  };
  const progressLabel = $derived(
    updateState.progress
      ? (PROGRESS_LABELS[updateState.progress.phase]?.() ?? updateState.progress.phase)
      : '',
  );
</script>

<div class="border border-border rounded-lg overflow-hidden mb-6">
  <div class="relative px-4 py-3 border-b border-border bg-bg/60 flex items-center gap-2">
    <ScanLine speed={10} opacity={0.02} />
    <PackageCheck size={12} class="text-muted-strong" />
    <span class="text-[10px] font-mono text-muted uppercase tracking-widest">{m.gateway_update_title()}</span>
  </div>

  <div class="p-4 space-y-3">
    {#if !conn.connected}
      <p class="text-xs text-muted-foreground">{m.gateway_update_disconnected()}</p>
    {:else}
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <div class="text-xs text-muted-strong">{m.gateway_update_currentVersion()}</div>
          <div class="text-sm font-mono text-foreground">
            v{currentVersion ?? '—'}
            {#if shortSha}<span class="text-muted-strong">&nbsp;({shortSha})</span>{/if}
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            onclick={checkNow}
            disabled={checking}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono bg-bg border-border text-muted hover:text-foreground disabled:opacity-50"
          >
            <RotateCw size={12} class={checking ? 'animate-spin' : ''} />
            {checking ? m.gateway_update_checking() : m.gateway_update_checkNow()}
          </button>
          {#if updateState.pending}
            <button
              onclick={installNow}
              disabled={installBusy}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 disabled:opacity-50"
            >
              <Download size={12} />
              {installBusy ? m.gateway_update_installing() : m.gateway_update_installAndRestart()}
            </button>
          {/if}
        </div>
      </div>

      {#if statusError}
        <p class="text-xs text-destructive">{statusError}</p>
      {/if}

      {#if updateState.pending}
        <div class="rounded border border-accent/30 bg-accent/5 px-3 py-2">
          <div class="flex items-center gap-1.5 text-xs font-medium text-accent">
            <Download size={12} />
            v{updateState.pending.version}
          </div>
          {#if updateState.pending.notes}
            <p class="text-xs text-muted-foreground mt-1 whitespace-pre-line">{updateState.pending.notes}</p>
          {/if}
        </div>
      {/if}

      {#if updateState.progress}
        {@const pct = Math.max(0, Math.min(100, Math.round(updateState.progress.pct)))}
        <div class="space-y-1">
          <div class="flex items-center justify-between text-[10px] font-mono text-muted">
            <span class="uppercase tracking-widest">{progressLabel}</span>
            <span>{pct}%</span>
          </div>
          <div
            class="h-1.5 rounded-full bg-border/60 overflow-hidden"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={progressLabel}
          >
            <!-- Width moves only on real signals (WS progress events or stage
                 inference) — no time-based fake animation, just an eased tween
                 between real values. -->
            <div
              class="h-full rounded-full transition-[width] duration-500 ease-out {pct >= 100
                ? 'bg-success'
                : 'bg-accent'}"
              style="width: {pct}%"
            ></div>
          </div>
          {#if updateState.progress.detail}
            <p class="text-[10px] font-mono text-muted-strong">{updateState.progress.detail}</p>
          {/if}
        </div>
      {/if}

      {#if updateState.lastResult}
        <p class="text-xs {updateState.lastResult.ok ? 'text-muted-foreground' : 'text-destructive'} flex items-center gap-1.5">
          {#if !updateState.lastResult.ok}<AlertTriangle size={12} />{/if}
          {updateState.lastResult.ok
            ? m.gateway_update_lastResultOk({ from: updateState.lastResult.from, to: updateState.lastResult.to })
            : m.gateway_update_lastResultFailed({ version: updateState.lastResult.rolledBackTo ?? updateState.lastResult.from })}
        </p>
      {/if}

      <div class="pt-2 border-t border-border/60">
        <div class="text-[10px] font-mono text-muted uppercase tracking-widest mb-1">{m.gateway_update_notifyTargets()}</div>
        {#if notifyTargets.length === 0}
          <p class="text-xs text-muted-strong">{m.gateway_update_notifyNone()}</p>
        {:else}
          <ul class="text-xs text-muted-foreground space-y-0.5">
            {#each notifyTargets as target, i (i)}
              <li class="font-mono">{target.channel}: {target.to}</li>
            {/each}
          </ul>
        {/if}
        <a href="/config" class="text-[10px] text-accent hover:underline">{m.gateway_update_notifyEditHint()}</a>
      </div>
    {/if}
  </div>
</div>
