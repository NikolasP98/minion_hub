<script lang="ts">
  import { Button } from '$lib/components/ui';
import * as m from '$lib/paraglide/messages';
  import { submitOnModEnter } from '$lib/hotkeys';
  import {
    fmtSize,
    orderBand,
    sortSections,
    stepIconFor,
    stepStatusClassFor,
    type GroupMode,
    type PipelineStep,
    type SectionEntry,
    type SortMode,
    type StepStatus,
  } from './types';

  let {
    groupMode = $bindable(),
    sortMode = $bindable(),
    viewContext,
    hasSections,
    selectedSectionId,
    layerMeta,
    sections,
    classicSteps,
    activeStep,
    stepStatus,
    testPrompt = $bindable(),
    testing,
    loading,
    disabledIds,
    totalCount,
    onSelectSection,
    onSelectStep,
    onToggleSection,
    onRunTest,
    onRefresh,
  }: {
    groupMode: GroupMode;
    sortMode: SortMode;
    viewContext: 'inspect' | 'simulate';
    hasSections: boolean;
    selectedSectionId: string | null;
    layerMeta: Record<string, { label: string; color: string; description: string }>;
    /** All sections (enriched), already filtered to the visible set. */
    sections: SectionEntry[];
    classicSteps: Array<{ id: string; label: string }>;
    activeStep: number;
    stepStatus: Record<string, StepStatus>;
    testPrompt: string;
    testing: boolean;
    loading: boolean;
    disabledIds: Set<string>;
    /** Total section count (for the "n / m" fraction when filtered). */
    totalCount: number;
    onSelectSection: (id: string) => void;
    onSelectStep: (idx: number) => void;
    onToggleSection: (id: string, disabled: boolean) => void;
    onRunTest: () => void;
    onRefresh: () => void;
  } = $props();

  const GROUPS: Array<{ id: GroupMode; label: string }> = [
    { id: 'layer', label: 'Layer' },
    { id: 'none', label: 'None' },
    { id: 'pipeline', label: 'Pipeline' },
  ];
  const SORTS: Array<{ id: SortMode; label: string }> = [
    { id: 'cached', label: 'Cached' },
    { id: 'order', label: 'Order' },
    { id: 'alpha', label: 'Alpha' },
    { id: 'size', label: 'Size' },
  ];

  function sizeOf(s: SectionEntry): number {
    return s.bytes ?? s.chars ?? 0;
  }

  // Sorted flat list (for Group=None) and per-layer groups (Group=Layer).
  const sorted = $derived(sortSections(sections, sortMode));

  const layerGroups = $derived.by(() => {
    const out: Array<{ id: string; meta: { label: string; color: string }; rows: SectionEntry[] }> = [];
    for (const [layerId, meta] of Object.entries(layerMeta)) {
      const rows = sorted.filter((s) => s.layer === layerId);
      if (rows.length > 0) out.push({ id: layerId, meta, rows });
    }
    // Catch any unknown layers not present in layerMeta.
    const known = new Set(Object.keys(layerMeta));
    const others = sorted.filter((s) => !known.has(s.layer));
    if (others.length > 0) {
      out.push({ id: '_other', meta: { label: 'Other', color: 'var(--color-text-tertiary)' }, rows: others });
    }
    return out;
  });

  const readBack = $derived(
    `${sections.length === totalCount ? `${totalCount} sections` : `${sections.length} / ${totalCount}`} · ${groupMode} · ${sortMode}`,
  );

  function layerColor(layer: string): string {
    return layerMeta[layer]?.color ?? 'var(--color-text-tertiary)';
  }

  function runTestIfReady() {
    if (!testing && !loading && testPrompt.trim()) onRunTest();
  }
</script>

<div class="w-full h-full border-r border-border bg-bg2 overflow-y-auto flex flex-col">
  <!-- Header: group / sort controls -->
  <div class="shrink-0 px-3 py-2 border-b border-border space-y-1.5">
    <div class="flex items-center gap-1.5">
      <span class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wider text-muted shrink-0">Group</span>
      <div class="flex rounded border border-border overflow-hidden">
        {#each GROUPS as g (g.id)}
          <Button variant="ghost"
            type="button"
            class="text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 transition-colors cursor-pointer
              {groupMode === g.id ? 'bg-accent/15 text-accent font-semibold' : 'text-muted hover:text-foreground'}"
            onclick={() => (groupMode = g.id)}
          >
            {g.label}
          </Button>
        {/each}
      </div>
    </div>
    {#if groupMode !== 'pipeline'}
      <div class="flex items-center gap-1.5">
        <span class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wider text-muted shrink-0">Sort</span>
        <div class="flex rounded border border-border overflow-hidden">
          {#each SORTS as s (s.id)}
            <Button variant="ghost"
              type="button"
              class="text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 transition-colors cursor-pointer
                {sortMode === s.id ? 'bg-accent/15 text-accent font-semibold' : 'text-muted hover:text-foreground'}"
              onclick={() => (sortMode = s.id)}
            >
              {s.label}
            </Button>
          {/each}
        </div>
      </div>
    {/if}
    <p class="text-[length:var(--font-size-telemetry)] text-foreground/40 font-mono lowercase">{readBack}</p>
  </div>

  {#if groupMode === 'pipeline'}
    <!-- Pipeline view: numbered 9-stage list -->
    <div class="flex-1 py-1">
      {#each classicSteps as step, i (step.id)}
        <Button variant="ghost"
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer
            {activeStep === i
            ? 'bg-accent/10 border-l-2 border-accent text-foreground'
            : 'border-l-2 border-transparent text-muted hover:text-foreground hover:bg-[var(--color-text-primary)]/[0.03]'}"
          onclick={() => onSelectStep(i)}
        >
          <span
            class="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[length:var(--font-size-telemetry)] font-bold
              {activeStep === i ? 'bg-accent text-[var(--color-text-primary)]' : 'bg-bg1 text-muted border border-border'}"
          >
            {i + 1}
          </span>
          <span class="text-[length:var(--font-size-caption)] font-medium truncate">{step.label}</span>
          {#if stepStatus[step.id]}
            <span class={`shrink-0 ml-auto text-[length:var(--font-size-caption)] font-mono ${stepStatusClassFor(stepStatus[step.id])}`}>
              {stepIconFor(stepStatus[step.id])}
            </span>
          {/if}
        </Button>
      {/each}
    </div>
  {:else if hasSections}
    <div class="flex-1 py-1" role="listbox" aria-label="Prompt sections">
      {#if groupMode === 'layer'}
        {#each layerGroups as group (group.id)}
          {@const groupChars = group.rows.reduce((a, s) => a + sizeOf(s), 0)}
          <div class="px-3 pt-2 pb-0.5 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full shrink-0" style:background-color={group.meta.color}></span>
            <span class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-widest text-muted flex-1">{group.meta.label}</span>
            <span class="text-[length:var(--font-size-telemetry)] font-mono text-foreground/30 tabular-nums">{fmtSize(groupChars)}</span>
          </div>
          {#each group.rows as section (section.id)}
            {@render row(section)}
          {/each}
        {/each}
      {:else}
        <!-- Group=None: flat list; banded dividers when Sort=Order -->
        {#each sorted as section, i (section.id)}
          {#if sortMode === 'order' && (i === 0 || orderBand(sorted[i - 1].order) !== orderBand(section.order))}
            <div class="px-3 pt-2 pb-0.5">
              <span class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-widest text-foreground/30 font-mono">order {orderBand(section.order)}</span>
            </div>
          {/if}
          {@render row(section)}
        {/each}
      {/if}
    </div>
  {:else}
    <div class="flex-1 flex items-center justify-center px-4 py-6 text-center text-[length:var(--font-size-caption)] text-muted">
      No sections available.
    </div>
  {/if}

  <!-- Docked composer (Simulate) / session info (Inspect) -->
  <div class="shrink-0 px-3 py-2 border-t border-border space-y-1.5">
    {#if viewContext === 'simulate'}
      <p class="text-[length:var(--font-size-telemetry)] text-foreground/40 leading-tight">
        Session-independent preview — the backend renders the current agent state; test text is
        captured for the upcoming live stream.
      </p>
      <label class="block">
        <span class="block text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-widest text-muted mb-1">Simulate: test input</span>
        <textarea
          bind:value={testPrompt}
          rows="2"
          {@attach submitOnModEnter(runTestIfReady)}
          class="w-full text-[length:var(--font-size-caption)] px-2 py-1.5 rounded border border-border bg-bg1 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/60 focus:min-h-[80px] transition-[min-height] resize-none font-mono"
          placeholder="Enter a sample message… (⌘↵ to run)"
          disabled={testing}
        ></textarea>
      </label>
      <Button variant="ghost"
        type="button"
        class="w-full text-[length:var(--font-size-telemetry)] font-semibold px-2 py-1.5 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-40"
        onclick={onRunTest}
        disabled={testing || loading || !testPrompt.trim()}
      >
        {testing ? m.prompt_generating() : '▶ Run ⌘↵'}
      </Button>
    {:else}
      <Button variant="ghost"
        type="button"
        class="w-full text-[length:var(--font-size-telemetry)] font-semibold px-2 py-1.5 rounded border border-border text-muted hover:text-foreground hover:border-accent/50 transition-colors cursor-pointer"
        onclick={onRefresh}
        disabled={loading || testing}
      >
        {loading ? m.common_loading() : m.prompt_refresh()}
      </Button>
    {/if}
  </div>
</div>

{#snippet row(section: SectionEntry)}
  {@const isSelected = selectedSectionId === section.id}
  {@const isOff = disabledIds.has(section.id)}
  <div
    class="group/row relative w-full flex items-center gap-2 pr-2 pl-3 h-7 text-left transition-colors
      {isSelected ? 'bg-accent/10 text-foreground' : 'text-muted hover:text-foreground hover:bg-[var(--color-text-primary)]/[0.03]'}"
    role="option"
    aria-selected={isSelected}
    style:border-left="2px solid {isOff ? 'var(--color-warning-fg)' : isSelected ? 'var(--color-accent, var(--color-info-fg))' : `${layerColor(section.layer)}55`}"
  >
    <!-- Hover-reveal order gutter -->
    <span class="shrink-0 w-7 text-[length:var(--font-size-telemetry)] font-mono text-foreground/25 opacity-0 group-hover/row:opacity-100 transition-opacity text-right">
      {section.order}
    </span>
    <Button variant="ghost"
      type="button"
      class="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
      onclick={() => onSelectSection(section.id)}
    >
      <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] truncate {isOff ? 'line-through opacity-50' : ''}">{section.label}</span>
      {#if isOff}
        <span
          class="shrink-0 text-[length:var(--font-size-telemetry)] font-semibold px-1 py-0.5 rounded bg-[var(--color-warning-surface)] text-[var(--color-warning-fg)] cursor-pointer hover:bg-[var(--color-warning-surface)]"
          role="button"
          tabindex="0"
          title="Re-enable this section"
          onclick={(e) => {
            e.stopPropagation();
            onToggleSection(section.id, false);
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onToggleSection(section.id, false);
            }
          }}
        >overridden</span>
      {/if}
    </Button>
    <!-- Hover-reveal cacheable bolt -->
    {#if section.cacheable}
      <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)] opacity-0 group-hover/row:opacity-100 transition-opacity" title="Cacheable">⚡</span>
    {/if}
    <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-foreground/40 font-mono tabular-nums w-9 text-right">{fmtSize(sizeOf(section))}</span>
    <!-- Hover-reveal on/off toggle -->
    <Button variant="ghost"
      type="button"
      class="shrink-0 w-4 h-4 rounded flex items-center justify-center text-[length:var(--font-size-telemetry)] transition-opacity
        {isOff ? 'opacity-100 text-[var(--color-warning-fg)]' : 'opacity-0 group-hover/row:opacity-100 text-foreground/40 hover:text-foreground'}"
      title={isOff ? 'Enable section' : 'Disable section'}
      aria-label={isOff ? 'Enable section' : 'Disable section'}
      onclick={() => onToggleSection(section.id, !isOff)}
    >
      {isOff ? '○' : '●'}
    </Button>
  </div>
{/snippet}
