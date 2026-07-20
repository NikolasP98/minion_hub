<script lang="ts">
  import { Button, ProgressBar, iconSizes } from '$lib/components/ui';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { getActiveHost } from '$lib/state/features/hosts.svelte';
  import {
    updateState,
    applyUpdateStatus,
    isUpdateRestartExpected,
    setUpdateProgress,
  } from '$lib/state/gateway/update-state.svelte';
  import { configState, loadConfig, getField, restartState } from '$lib/state/config/config.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { PackageCheck, Download, RotateCw, AlertTriangle, Square } from 'lucide-svelte';

  const { gatewayCount = 1 }: { gatewayCount?: number } = $props();

  // ── Fleet update (spec `specs/2026-07-11-fleet-update-orchestration.md`) ──
  // "Install" always drives the fleet flow — a single instance is just a
  // fleet of one (round-4 fix 3: fleet IS the update method, no second CTA).
  type FleetInstanceState = 'pending' | 'draining' | 'updating' | 'verifying' | 'done' | 'failed';
  type FleetInstance = {
    gatewayId: string;
    name: string;
    url: string;
    state: FleetInstanceState;
    /** null = unknown (old gateway build, or unreachable at snapshot time). */
    connections: number | null;
    fromVersion: string | null;
    toVersion: string;
    error?: string;
    /** True progress relayed server-side from the gateway's update.progress
     * broadcasts and persisted in the job row (round-6) — renders for EVERY
     * instance via job polling, not just the one this browser is connected to. */
    progressPct?: number | null;
    progressPhase?: string | null;
  };
  type FleetJob = {
    id: string;
    targetVersion: string;
    targetSource: 'package' | 'external-image' | 'mixed';
    instances: FleetInstance[];
    currentIndex: number;
    status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
    error: string | null;
    startedBy: string | null;
    active: boolean;
  };

  let job = $state<FleetJob | null>(null);
  let starting = $state(false);
  let running = $state(false);

  const STATE_LABELS: Record<FleetInstanceState, () => string> = {
    pending: m.fleet_update_state_pending,
    draining: m.fleet_update_state_draining,
    updating: m.fleet_update_state_updating,
    verifying: m.fleet_update_state_verifying,
    done: m.fleet_update_state_done,
    failed: m.fleet_update_state_failed,
  };
  const STATE_CLASS: Record<FleetInstanceState, string> = {
    pending: 'bg-muted text-muted-foreground',
    draining: 'bg-warning/10 text-warning',
    updating: 'bg-warning/10 text-warning',
    verifying: 'bg-warning/10 text-warning',
    done: 'bg-success/10 text-success',
    failed: 'bg-destructive/10 text-destructive',
  };
  // Round-5: stage-inferred fallback pct for the connected row's bar when no
  // real `update.progress` WS event has landed yet (or ever, e.g. an older
  // gateway build that doesn't emit them) — driven purely by this instance's
  // own job state, independent of other instances' outcomes.
  const STAGE_FALLBACK_PCT: Partial<Record<FleetInstanceState, number>> = {
    draining: 10,
    updating: 20,
    verifying: 50,
  };

  async function callFleet(body: Record<string, unknown>): Promise<FleetJob | null> {
    const res = await fetch('/api/gateway/fleet-update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      toastError(m.fleet_update_alreadyActive());
      return null;
    }
    if (!res.ok) throw new Error(`fleet-update ${body.action} failed: ${res.status}`);
    const view = (await res.json()) as FleetJob | { active: false };
    return 'instances' in view ? view : null;
  }

  /** Drive advance() sequentially while this component stays mounted — each
   * call is exactly one instance step; stop on failed/aborted/done.
   *
   * Round-5: `advance` is a single blocking call that only resolves once the
   * whole instance step (drain+run+poll-verify, up to ~240s) finishes — so
   * `job` never observed the draining/updating/verifying sub-states in
   * between, and the per-row progress bar (gated on those states) never
   * rendered even though the server was writing them the whole time. Poll
   * the lightweight `status` action in parallel to pick those up live. */
  async function driveFleet(): Promise<void> {
    if (running) return;
    running = true;
    const poll = setInterval(() => {
      if (!running) return;
      callFleet({ action: 'status' })
        .then((s) => {
          if (running && s) job = s;
        })
        .catch(() => {});
    }, 3000);
    try {
      while (job?.active) {
        const next = await callFleet({ action: 'advance' });
        if (!next) break;
        job = next;
      }
      if (job?.status === 'failed') {
        toastError(m.fleet_update_advanceFailed(), job.error ?? undefined);
      } else if (job?.status === 'done') {
        toastSuccess(m.fleet_update_completed({ version: job.targetVersion }));
        // Done jobs don't linger in the card — refresh current/pending and
        // drop back to the normal (no-job) view.
        job = null;
        await refreshStatus();
      }
    } catch (err) {
      toastError(m.fleet_update_advanceFailed(), err instanceof Error ? err.message : undefined);
    } finally {
      running = false;
      clearInterval(poll);
    }
  }

  async function startFleet(
    targetVersion: string,
    targetSource: 'package' | 'external-image' | 'mixed',
  ): Promise<void> {
    if (starting || running) return;
    starting = true;
    try {
      const started = await callFleet({ action: 'start', targetVersion, targetSource });
      if (!started) return;
      job = started;
      // Round-5: arm the bar immediately (parity with the old single-instance
      // installNow()) instead of waiting on the first WS update.progress
      // event or status poll — only paints on the row(s) whose state later
      // goes draining/updating/verifying (see rowBusy below).
      setUpdateProgress({ phase: 'starting', pct: 5 });
      void driveFleet();
    } catch (err) {
      toastError(m.fleet_update_startFailed(), err instanceof Error ? err.message : undefined);
    } finally {
      starting = false;
    }
  }

  async function abortFleet(): Promise<void> {
    if (!job) return;
    try {
      const aborted = await callFleet({ action: 'abort' });
      if (aborted) job = aborted;
      toastSuccess(m.fleet_update_aborted());
    } catch (err) {
      toastError(m.fleet_update_advanceFailed(), err instanceof Error ? err.message : undefined);
    }
  }

  /** A terminal-failed job isn't self-healing — surface a one-click restart
   * of the same target version rather than bricking the card (round-4 fix 3). */
  function retryFleet(): void {
    if (!job) return;
    void startFleet(job.targetVersion, job.targetSource);
  }

  const doneCount = $derived(job?.instances.filter((i) => i.state === 'done').length ?? 0);
  // The instance the admin's own browser is connected to — the only one WS
  // `update.progress` events can arrive from, so it's the only row that gets
  // the granular phase/pct bar (matched by url, same as the gateways page's
  // Turso/PG dedup — see gateways/+page.svelte tursoUrlSet).
  const connectedUrl = $derived(conn.connected ? (getActiveHost()?.url ?? null) : null);

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
    // Resume an already-active (or terminal-failed) fleet job on mount — a
    // page reload mid-rollout picks the driving loop back up; a failed job
    // stays visible with its Retry action instead of vanishing.
    (async () => {
      try {
        const status = await callFleet({ action: 'status' });
        if (status && (status.active || status.status === 'failed')) {
          job = status;
          if (status.active) {
            // Re-arm the expected-restart window (client state died with the
            // reload) so a mid-rollout disconnect stays amber and the card
            // body stays mounted (round-6).
            if (!updateState.progress) setUpdateProgress({ phase: 'starting', pct: 5 });
            void driveFleet();
          }
        }
      } catch {
        // non-critical — the Install button still works from scratch
      }
    })();
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

  /** Install button: confirm, then hand off to the fleet flow (round-4 fix 3
   * — fleet IS the update method now, even for a single instance). */
  function installNow() {
    if (!updateState.pending || starting || running || job?.active) return;
    if (
      !confirm(
        m.fleet_update_confirmStart({ version: updateState.pending.version, count: gatewayCount }),
      )
    )
      return;
    void startFleet(updateState.pending.version, updateState.targetSource);
  }

  const shortSha = $derived(gw.hello?.server?.commit?.slice(0, 7) ?? null);
  // update.status's `current` is the full timestamped version
  // (e.g. 2026.7.10-dev.20260710220841); hello.server.version can be a bare
  // channel tag ("dev") — only use it as a fallback.
  const currentVersion = $derived(updateState.current ?? gw.hello?.server?.version ?? null);
  const notifyTargets = $derived(
    (getField('update.notify') as { channel: string; to: string }[] | undefined) ?? [],
  );
  const installBusy = $derived(
    starting || running || !!job?.active || restartState.phase === 'restarting',
  );

  const PROGRESS_LABELS: Record<string, () => string> = {
    migrating: m.gateway_update_phase_migrating,
    starting: m.gateway_update_phase_starting,
    installing: m.gateway_update_phase_installing,
    installed: m.gateway_update_phase_installed,
    'watchdog-armed': m.gateway_update_phase_watchdog,
    restarting: m.gateway_update_phase_restarting,
    done: m.gateway_update_phase_done,
  };
  // Render the dwell-smoothed display layer (truth stays in updateState.progress).
  const shownProgress = $derived(updateState.display);
  // Live elapsed-seconds counter for the long `installing` hold (real time,
  // not fake progress) so the 15% plateau reads as alive.
  let phaseElapsed = $state(0);
  $effect(() => {
    phaseElapsed = 0;
    if (shownProgress?.phase !== 'installing') return;
    const started = Date.now();
    const t = setInterval(() => {
      phaseElapsed = Math.floor((Date.now() - started) / 1000);
    }, 1000);
    return () => clearInterval(t);
  });
  const progressLabel = $derived(
    shownProgress
      ? (PROGRESS_LABELS[shownProgress.phase]?.() ?? shownProgress.phase) +
          (shownProgress.phase === 'installing' && phaseElapsed > 0 ? ` — ${phaseElapsed}s` : '')
      : '',
  );
</script>

<div class="border border-border rounded-lg overflow-hidden mb-6">
  <div class="relative px-4 py-3 border-b border-border bg-bg/60 flex items-center gap-2">
    <ScanLine speed={10} opacity={0.02} />
    <PackageCheck size={iconSizes.xs} class="text-muted-strong" />
    <span class="text-xs font-mono text-muted uppercase tracking-widest"
      >{m.gateway_update_title()}</span
    >
  </div>

  <div class="p-4 space-y-3">
    <!-- An install in flight means the disconnect IS the expected restart step:
         keep the card body (progress bar at "restarting — reconnecting…")
         mounted instead of swapping to "Not connected to gateway." -->
    {#if !conn.connected && !isUpdateRestartExpected() && restartState.phase !== 'restarting'}
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
          <Button
            variant="secondary"
            size="sm"
            onclick={checkNow}
            loading={checking}
            class="font-mono"
          >
            {checking ? m.gateway_update_checking() : m.gateway_update_checkNow()}
          </Button>
          {#if updateState.pending && !job?.active && job?.status !== 'failed'}
            <Button
              variant="primary"
              size="sm"
              onclick={installNow}
              loading={installBusy}
              class="font-mono"
            >
              <Download size={iconSizes.xs} />
              {installBusy
                ? m.gateway_update_installing()
                : updateState.targetSource === 'external-image' ||
                    updateState.targetSource === 'mixed'
                  ? m.gateway_update_rolloutImage()
                  : m.gateway_update_installAndRestart()}
            </Button>
          {/if}
        </div>
      </div>

      {#if statusError}
        <p class="text-xs text-destructive">{statusError}</p>
      {/if}

      {#if updateState.pending}
        <div class="rounded border border-accent/30 bg-accent/5 px-3 py-2">
          <div class="flex items-center gap-1.5 text-xs font-medium text-accent">
            <Download size={iconSizes.xs} />
            v{updateState.pending.version}
          </div>
          {#if updateState.pending.notes}
            <p class="text-xs text-muted-foreground mt-1 whitespace-pre-line">
              {updateState.pending.notes}
            </p>
          {/if}
        </div>
      {/if}

      {#if job && (job.active || job.status === 'failed')}
        <div class="pt-2 border-t border-border/60 space-y-2">
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs font-mono text-muted uppercase tracking-widest">
              {m.fleet_update_progress({ done: doneCount, total: job.instances.length })}
            </span>
            {#if job.active}
              <Button
                variant="danger"
                size="sm"
                onclick={abortFleet}
                class="font-mono text-xs"
              >
                <Square size={10} />
                {m.fleet_update_abort()}
              </Button>
            {/if}
          </div>

          <ul class="space-y-1.5">
            {#each job.instances as inst (inst.gatewayId)}
              {@const rowConnected = conn.connected && connectedUrl === inst.url}
              {@const rowBusy =
                inst.state === 'draining' ||
                inst.state === 'updating' ||
                inst.state === 'verifying'}
              <li class="text-xs px-2 py-1.5 rounded border border-border/60 bg-bg/40 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono truncate">
                    {inst.name}
                    <span class="text-muted-strong"
                      >&middot; {inst.connections === null
                        ? '—'
                        : m.fleet_update_connections({ count: inst.connections })}</span
                    >
                  </span>
                  <span
                    class="shrink-0 px-1.5 py-0.5 rounded-full text-xs font-medium {STATE_CLASS[
                      inst.state
                    ]}"
                  >
                    {STATE_LABELS[inst.state]()}
                  </span>
                </div>

                <!-- Per-instance progress bar for every busy row (round-6).
                     Primary source: the job row's server-persisted pct/phase
                     (relayed from the gateway's update.progress broadcasts by
                     the orchestrator, picked up here by the 3s status poll) —
                     works even when this browser's own gateway WS is down.
                     The dwell-smoothed WS layer still wins for the instance
                     this browser is connected to (instant + detail line). -->
                {#if rowBusy}
                  {@const jobPct = typeof inst.progressPct === 'number' ? inst.progressPct : null}
                  {@const useWs = rowConnected && shownProgress != null}
                  {@const active = useWs
                    ? shownProgress
                    : jobPct !== null
                      ? { phase: inst.progressPhase ?? inst.state, pct: jobPct }
                      : { phase: inst.state, pct: STAGE_FALLBACK_PCT[inst.state] ?? 0 }}
                  {@const pct = Math.max(0, Math.min(100, Math.round(active.pct)))}
                  {@const phaseLabel = useWs
                    ? progressLabel
                    : (PROGRESS_LABELS[active.phase]?.() ?? STATE_LABELS[inst.state]())}
                  <div class="space-y-1">
                    <ProgressBar size="sm" value={pct} max={100} detail={`${pct}%`}>
                      {#snippet label()}
                        <span class="uppercase tracking-widest font-mono">{phaseLabel}</span>
                      {/snippet}
                    </ProgressBar>
                    {#if shownProgress?.detail}
                      <p class="text-xs font-mono text-muted-strong">{shownProgress.detail}</p>
                    {/if}
                  </div>
                {/if}

                {#if inst.state === 'failed' && inst.error}
                  <p class="text-xs text-destructive">{inst.error}</p>
                {/if}
              </li>
            {/each}
          </ul>

          {#if job.status === 'failed'}
            <div class="flex items-center justify-between gap-2">
              {#if job.error}<p class="text-xs text-destructive truncate">{job.error}</p>{/if}
              <Button
                variant="outline"
                size="sm"
                onclick={retryFleet}
                loading={starting}
                class="shrink-0 font-mono text-xs"
              >
                {m.fleet_update_retry()}
              </Button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Reconcile-to-truth: a "failed / rolled back" record is moot when the
           gateway is ALREADY running that update's target version (e.g. the
           orchestrator's verify timed out but a later manual/retried install
           landed it) — suppress the scare line rather than contradict reality. -->
      {#if updateState.lastResult && !(updateState.lastResult.ok === false && updateState.lastResult.to === currentVersion)}
        <p
          class="text-xs {updateState.lastResult.ok
            ? 'text-muted-foreground'
            : 'text-destructive'} flex items-center gap-1.5"
        >
          {#if !updateState.lastResult.ok}<AlertTriangle size={iconSizes.xs} />{/if}
          {updateState.lastResult.ok
            ? m.gateway_update_lastResultOk({
                from: updateState.lastResult.from,
                to: updateState.lastResult.to,
              })
            : m.gateway_update_lastResultFailed({
                version: updateState.lastResult.rolledBackTo ?? updateState.lastResult.from,
              })}
        </p>
      {/if}

      <div class="pt-2 border-t border-border/60">
        <div class="text-xs font-mono text-muted uppercase tracking-widest mb-1">
          {m.gateway_update_notifyTargets()}
        </div>
        {#if notifyTargets.length === 0}
          <p class="text-xs text-muted-strong">{m.gateway_update_notifyNone()}</p>
        {:else}
          <ul class="text-xs text-muted-foreground space-y-0.5">
            {#each notifyTargets as target, i (i)}
              <li class="font-mono">{target.channel}: {target.to}</li>
            {/each}
          </ul>
        {/if}
        <a href="/config" class="text-xs text-accent hover:underline"
          >{m.gateway_update_notifyEditHint()}</a
        >
      </div>
    {/if}
  </div>
</div>
