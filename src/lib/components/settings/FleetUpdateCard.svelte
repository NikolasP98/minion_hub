<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { updateState } from '$lib/state/gateway/update-state.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { Layers, Square } from 'lucide-svelte';

  const { gatewayCount }: { gatewayCount: number } = $props();

  type FleetInstanceState = 'pending' | 'draining' | 'updating' | 'verifying' | 'done' | 'failed';
  type FleetInstance = {
    gatewayId: string;
    name: string;
    url: string;
    state: FleetInstanceState;
    connections: number;
    fromVersion: string | null;
    toVersion: string;
    error?: string;
  };
  type FleetJob = {
    id: string;
    targetVersion: string;
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

  // Only surfaces on a multi-instance fleet with a pending version detected
  // on the instance the browser happens to be connected to (spec §3.3).
  const visible = $derived(gatewayCount > 1 && !!updateState.pending);

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
   * call is exactly one instance step (spec §3.2); stop on failed/aborted. */
  async function driveFleet(): Promise<void> {
    if (running) return;
    running = true;
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
      }
    } catch (err) {
      toastError(m.fleet_update_advanceFailed(), err instanceof Error ? err.message : undefined);
    } finally {
      running = false;
    }
  }

  async function startFleet(): Promise<void> {
    if (!updateState.pending || starting || running) return;
    if (
      !confirm(
        m.fleet_update_confirmStart({ version: updateState.pending.version, count: gatewayCount }),
      )
    )
      return;
    starting = true;
    try {
      const started = await callFleet({ action: 'start', targetVersion: updateState.pending.version });
      if (!started) return;
      job = started;
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

  // Resume an already-active job on mount — a page reload mid-rollout picks
  // the driving loop back up (spec §3.3: "page close = job pauses safely").
  onMount(() => {
    (async () => {
      try {
        const status = await callFleet({ action: 'status' });
        if (status?.active) {
          job = status;
          void driveFleet();
        }
      } catch {
        // non-critical — the Update fleet button still works from scratch
      }
    })();
  });

  const doneCount = $derived(job?.instances.filter((i) => i.state === 'done').length ?? 0);
</script>

{#if visible}
  <div class="border border-border rounded-lg overflow-hidden mb-6">
    <div class="relative px-4 py-3 border-b border-border bg-bg/60 flex items-center gap-2">
      <ScanLine speed={10} opacity={0.02} />
      <Layers size={12} class="text-muted-strong" />
      <span class="text-[10px] font-mono text-muted uppercase tracking-widest">{m.fleet_update_title()}</span>
    </div>

    <div class="p-4 space-y-3">
      {#if !job}
        <button
          onclick={startFleet}
          disabled={starting}
          class="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 disabled:opacity-50"
        >
          <Layers size={12} />
          {starting ? m.fleet_update_starting() : m.fleet_update_button()}
        </button>
      {:else}
        <div class="flex items-center justify-between gap-3">
          <span class="text-[10px] font-mono text-muted uppercase tracking-widest">
            {m.fleet_update_progress({ done: doneCount, total: job.instances.length })}
          </span>
          {#if job.active}
            <button
              onclick={abortFleet}
              class="flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-mono bg-bg border-border text-muted hover:text-destructive"
            >
              <Square size={10} /> {m.fleet_update_abort()}
            </button>
          {/if}
        </div>

        <ul class="space-y-1.5">
          {#each job.instances as inst (inst.gatewayId)}
            <li class="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded border border-border/60 bg-bg/40">
              <span class="font-mono truncate">
                {inst.name}
                <span class="text-muted-strong">&middot; {m.fleet_update_connections({ count: inst.connections })}</span>
              </span>
              <span class="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium {STATE_CLASS[inst.state]}">
                {STATE_LABELS[inst.state]()}
              </span>
            </li>
          {/each}
        </ul>

        {#if job.status === 'failed' && job.error}
          <p class="text-xs text-destructive">{job.error}</p>
        {/if}
      {/if}
    </div>
  </div>
{/if}
