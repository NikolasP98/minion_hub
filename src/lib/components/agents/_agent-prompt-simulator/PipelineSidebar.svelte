<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import {
    fmtChars,
    stepIconFor,
    stepStatusClassFor,
    type PipelineStep,
    type SectionEntry,
    type StepStatus,
  } from './types';

  let {
    viewMode,
    hasSections,
    activeStep,
    layerMeta,
    activeSections,
    currentSteps,
    classicSteps,
    stepStatus,
    testPrompt = $bindable(),
    testing,
    loading,
    onToggleViewMode,
    onSelectStep,
    onRunTest,
    onRefresh,
  }: {
    viewMode: 'sections' | 'classic';
    hasSections: boolean;
    activeStep: number;
    layerMeta: Record<string, { label: string; color: string; description: string }>;
    activeSections: SectionEntry[];
    currentSteps: PipelineStep[];
    classicSteps: Array<{ id: string; label: string }>;
    stepStatus: Record<string, StepStatus>;
    testPrompt: string;
    testing: boolean;
    loading: boolean;
    onToggleViewMode: () => void;
    onSelectStep: (idx: number) => void;
    onRunTest: () => void;
    onRefresh: () => void;
  } = $props();
</script>

<div class="w-[200px] shrink-0 border-r border-border bg-bg2 overflow-y-auto flex flex-col">
  <div class="px-3 py-2 border-b border-border flex items-center justify-between">
    <span class="text-[10px] font-bold uppercase tracking-widest text-muted">{m.prompt_pipeline()}</span>
    {#if hasSections}
      <button
        type="button"
        class="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted hover:text-foreground transition-colors cursor-pointer"
        onclick={onToggleViewMode}
      >
        {viewMode === 'sections' ? m.prompt_classic() : m.prompt_sections()}
      </button>
    {/if}
  </div>

  {#if viewMode === 'sections' && hasSections}
    <!-- Sections view: grouped by layer -->
    <div class="flex-1 py-1">
      {#each Object.entries(layerMeta) as [layerId, meta] (layerId)}
        {@const layerSections = activeSections.filter((s) => s.layer === layerId)}
        {#if layerSections.length > 0}
          <div class="px-3 pt-2 pb-0.5">
            <span class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full shrink-0" style:background-color={meta.color}></span>
              <span class="text-[9px] font-bold uppercase tracking-widest text-muted">{meta.label}</span>
            </span>
          </div>
          {#each layerSections as section (section.id)}
            {@const stepIdx = currentSteps.findIndex((s) => s.id === section.id)}
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer
                {activeStep === stepIdx
                ? 'bg-accent/10 border-l-2 border-accent text-foreground'
                : 'border-l-2 border-transparent text-muted hover:text-foreground hover:bg-white/[0.03]'}"
              onclick={() => onSelectStep(stepIdx)}
            >
              {#if stepStatus[section.id]}
                <span class={`shrink-0 w-3 text-center text-[11px] font-mono ${stepStatusClassFor(stepStatus[section.id])}`}>
                  {stepIconFor(stepStatus[section.id])}
                </span>
              {/if}
              <span class="flex-1 min-w-0 text-[11px] truncate">{section.label}</span>
              <span class="shrink-0 text-[9px] text-foreground/30 font-mono">{section.chars > 0 ? fmtChars(section.chars) : ''}</span>
            </button>
          {/each}
        {/if}
      {/each}
    </div>
  {:else}
    <!-- Classic view -->
    <div class="flex-1 py-1">
      {#each classicSteps as step, i (step.id)}
        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer
            {activeStep === i
            ? 'bg-accent/10 border-l-2 border-accent text-foreground'
            : 'border-l-2 border-transparent text-muted hover:text-foreground hover:bg-white/[0.03]'}"
          onclick={() => onSelectStep(i)}
        >
          <span
            class="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold
              {activeStep === i ? 'bg-accent text-white' : 'bg-bg1 text-muted border border-border'}"
          >
            {i + 1}
          </span>
          <span class="text-[11px] font-medium truncate">{step.label}</span>
          {#if stepStatus[step.id]}
            <span class={`shrink-0 ml-auto text-[11px] font-mono ${stepStatusClassFor(stepStatus[step.id])}`}>
              {stepIconFor(stepStatus[step.id])}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Action buttons -->
  <div class="shrink-0 px-3 py-2 border-t border-border space-y-1.5">
    <!-- Phase D-0d: editable test prompt fed into the stepped playback -->
    <label class="block">
      <span class="block text-[9px] font-bold uppercase tracking-widest text-muted mb-1">
        Test prompt
      </span>
      <textarea
        bind:value={testPrompt}
        rows="2"
        class="w-full text-[11px] px-2 py-1.5 rounded border border-border bg-bg1 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/60 resize-none font-mono"
        placeholder="Enter a sample message…"
        disabled={testing}
      ></textarea>
    </label>
    <button
      type="button"
      class="w-full text-[10px] font-semibold px-2 py-1.5 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-40"
      onclick={onRunTest}
      disabled={testing || loading || !testPrompt.trim()}
    >
      {testing ? m.prompt_generating() : m.prompt_test()}
    </button>
    <button
      type="button"
      class="w-full text-[10px] font-semibold px-2 py-1 rounded border border-border text-muted hover:text-foreground hover:border-accent/50 transition-colors cursor-pointer"
      onclick={onRefresh}
      disabled={loading || testing}
    >
      {loading ? m.common_loading() : m.prompt_refresh()}
    </button>
  </div>
</div>
