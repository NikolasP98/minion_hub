<script lang="ts">
  import { Button } from '$lib/components/ui';
import {
    flowEditorState,
    loadHistoryRun,
    type RunnerEvent,
  } from '$lib/state/features/flow-editor.svelte';
  import { X, History, CheckCircle2, AlertCircle, Loader } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  type Run = {
    id: string;
    startedAt: number;
    durationMs: number;
    status: string;
    source?: string; // 'test' | 'production'
    events: RunnerEvent[];
  };

  let runs = $state<Run[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let selectedId = $state<string | null>(null);

  async function load() {
    const flowId = flowEditorState.flowId;
    if (!flowId) return;
    loading = true;
    loadError = null;
    try {
      const res = await fetch(`/api/flows/${flowId}/runs`);
      if (!res.ok) throw new Error(`Failed to load history (HTTP ${res.status})`);
      const data = (await res.json()) as { runs?: Run[] };
      runs = data.runs ?? [];
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // (Re)load whenever the drawer opens.
  $effect(() => {
    if (flowEditorState.historyOpen) load();
  });

  function nodeCount(events: RunnerEvent[]) {
    return events.filter((e) => e.kind === 'node-end' || e.kind === 'node-error').length;
  }

  function fmt(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  function openRun(run: Run) {
    selectedId = run.id;
    loadHistoryRun(run.events);
  }
</script>

{#if flowEditorState.historyOpen}
  <div
    class="absolute right-0 top-0 bottom-0 z-[var(--layer-dropdown)] flex w-80 flex-col border-l border-border bg-bg2/95 shadow-2xl shadow-black/40 backdrop-blur-md"
  >
    <!-- Header -->
    <div class="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
      <div class="flex items-center gap-1.5">
        <History size={13} class="text-muted" />
        <span class="font-mono text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-widest text-muted"
          >{m.flownode_runHistory()}</span
        >
        {#if runs.length > 0}
          <span class="rounded bg-bg3 px-1.5 py-0.5 font-mono text-[length:var(--font-size-telemetry)] text-muted/60">{runs.length}</span>
        {/if}
      </div>
      <Button variant="ghost"
        onclick={() => (flowEditorState.historyOpen = false)}
        class="flex h-5 w-5 items-center justify-center rounded text-muted/60 transition-colors hover:bg-bg3 hover:text-foreground"
        title={m.flownode_closeHistory()}
      >
        <X size={12} />
      </Button>
    </div>

    <!-- List -->
    <div class="flex-1 overflow-y-auto p-2">
      {#if loading}
        <div class="flex items-center justify-center gap-2 py-8 text-[length:var(--font-size-caption)] text-muted/60">
          <Loader size={13} class="animate-spin" /> {m.common_loading()}
        </div>
      {:else if loadError}
        <p class="px-2 py-4 text-[length:var(--font-size-caption)] text-[var(--color-danger-fg)]">{loadError}</p>
      {:else if runs.length === 0}
        <p class="px-2 py-4 text-[length:var(--font-size-caption)] italic text-muted/40">
          {m.flownode_noRunsYetHitTestRun()}
        </p>
      {:else}
        <div class="space-y-1">
          {#each runs as run (run.id)}
            <Button variant="ghost"
              onclick={() => openRun(run)}
              class="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors
                {selectedId === run.id
                ? 'border-accent/50 bg-accent/10'
                : 'border-transparent hover:border-border hover:bg-bg3'}"
            >
              {#if run.status === 'error'}
                <AlertCircle size={14} class="shrink-0 text-[var(--color-danger-fg)]" />
              {:else}
                <CheckCircle2 size={14} class="shrink-0 text-[var(--color-success-fg)]" />
              {/if}
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-[length:var(--font-size-caption)] text-foreground/90">{fmt(run.startedAt)}</span>
                  <span
                    class="shrink-0 rounded px-1 py-0.5 font-mono text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-wide {run.source ===
                    'production'
                      ? 'bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)] text-[var(--color-purple)] ring-1 ring-[color-mix(in_srgb,var(--color-purple)_30%,transparent)]'
                      : 'bg-bg3 text-muted/70'}"
                  >
                    {run.source === 'production' ? m.flownode_live() : m.flownode_test()}
                  </span>
                </div>
                <div class="font-mono text-[length:var(--font-size-telemetry)] text-muted/60">
                  {nodeCount(run.events)} {m.flownode_node({ count: nodeCount(run.events) })} ·
                  {(run.durationMs / 1000).toFixed(1)}s
                </div>
              </div>
            </Button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
