<script lang="ts">
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    fmtChars,
    SOURCE_META,
    type SectionEntry,
    type SystemPromptReport,
  } from './types';

  let {
    currentSection,
    report,
    layerMeta,
    totalChars,
    contentViewMode = $bindable(),
    onOpenEditor,
    onToggleDisabled,
  }: {
    currentSection: SectionEntry;
    report: SystemPromptReport;
    layerMeta: Record<string, { label: string; color: string; description: string }>;
    totalChars: number;
    contentViewMode: 'rendered' | 'raw';
    onOpenEditor: () => void;
    /** Override controls: toggle this section on/off. */
    onToggleDisabled?: (id: string, disabled: boolean) => void;
  } = $props();

  function barWidth(chars: number): string {
    if (!totalChars || chars <= 0) return '0%';
    return `${Math.min((chars / totalChars) * 100, 100).toFixed(1)}%`;
  }
</script>

<div class="p-4 space-y-4 max-w-2xl">
  <div>
    <div class="flex items-center gap-2 mb-1">
      <span class="w-2 h-2 rounded-full shrink-0" style:background-color={layerMeta[currentSection.layer]?.color ?? '#6b7280'}></span>
      <h2 class="text-sm font-semibold text-foreground">{currentSection.label}</h2>
      <span class="text-[9px] px-1.5 py-0.5 rounded bg-bg2 border border-border/50 text-muted font-mono">{currentSection.layer}</span>
      {#if currentSection.source}
        {@const meta = SOURCE_META[currentSection.source]}
        {#if currentSection.source === 'static'}
          <button
            type="button"
            class="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide hover:opacity-80 transition-opacity cursor-pointer"
            style:background-color={`${meta.color}22`}
            style:border={`1px solid ${meta.color}66`}
            style:color={meta.color}
            title={`${meta.description} — click to edit`}
            onclick={onOpenEditor}
          >
            {meta.label} ✎
          </button>
        {:else if currentSection.source === 'file'}
          <button
            type="button"
            class="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide hover:opacity-80 transition-opacity cursor-pointer"
            style:background-color={`${meta.color}22`}
            style:border={`1px solid ${meta.color}66`}
            style:color={meta.color}
            title={`${meta.description} — click to inspect`}
            onclick={onOpenEditor}
          >
            {meta.label} 🔍
          </button>
        {:else}
          <span
            class="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide"
            style:background-color={`${meta.color}22`}
            style:border={`1px solid ${meta.color}66`}
            style:color={meta.color}
            title={meta.description}
          >
            {meta.label}
          </span>
        {/if}
      {/if}
    </div>
    <p class="text-muted text-[11px] mb-3">
      {layerMeta[currentSection.layer]?.description ?? ''}
    </p>

    {#if currentSection.disabled}
      <div
        class="mb-3 flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5"
      >
        <span class="text-[11px] text-amber-400 flex-1">This section is overridden off.</span>
        {#if onToggleDisabled}
          <button
            type="button"
            class="text-[10px] font-semibold px-2 py-0.5 rounded border border-amber-500/50 text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
            onclick={() => onToggleDisabled?.(currentSection.id, false)}
          >
            Reset
          </button>
        {/if}
      </div>
    {:else if onToggleDisabled}
      <div class="mb-3">
        <button
          type="button"
          class="text-[10px] font-semibold px-2 py-0.5 rounded border border-border text-muted hover:text-foreground hover:border-accent/50 transition-colors cursor-pointer"
          onclick={() => onToggleDisabled?.(currentSection.id, true)}
        >
          Disable section
        </button>
      </div>
    {/if}

    <!-- Section stats -->
    <div class="space-y-2">
      <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
        <span class="shrink-0 w-20 text-[10px] font-bold uppercase tracking-wide text-muted">{m.prompt_sectionSection()}</span>
        <span class="flex-1 min-w-0 text-[11px] text-foreground font-mono">{currentSection.id}</span>
      </div>
      <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
        <span class="shrink-0 w-20 text-[10px] font-bold uppercase tracking-wide text-muted">{m.prompt_sectionChars()}</span>
        <span class="flex-1 min-w-0 text-[11px] text-foreground font-semibold">{fmtChars(currentSection.chars)}</span>
      </div>
      <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
        <span class="shrink-0 w-20 text-[10px] font-bold uppercase tracking-wide text-muted">{m.prompt_sectionOrder()}</span>
        <span class="flex-1 min-w-0 text-[11px] text-foreground font-mono">{currentSection.order}</span>
      </div>
      {#if currentSection.bytes !== undefined}
        <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
          <span class="shrink-0 w-20 text-[10px] font-bold uppercase tracking-wide text-muted">Bytes</span>
          <span class="flex-1 min-w-0 text-[11px] text-foreground font-mono">{currentSection.bytes.toLocaleString()}</span>
        </div>
      {/if}
      {#if currentSection.tokens !== undefined}
        <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
          <span class="shrink-0 w-20 text-[10px] font-bold uppercase tracking-wide text-muted">Tokens</span>
          <span class="flex-1 min-w-0 text-[11px] text-foreground font-mono">{currentSection.tokens.toLocaleString()}</span>
        </div>
      {/if}
      {#if currentSection.cacheable !== undefined}
        <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
          <span class="shrink-0 w-20 text-[10px] font-bold uppercase tracking-wide text-muted">Cacheable</span>
          <span class="flex-1 min-w-0 text-[11px] font-mono" class:text-amber-400={currentSection.cacheable} class:text-muted={!currentSection.cacheable}>
            {currentSection.cacheable ? '⚡ yes' : 'no'}
          </span>
        </div>
      {/if}
      <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
        <span class="shrink-0 w-20 text-[10px] font-bold uppercase tracking-wide text-muted">{m.prompt_sectionWeight()}</span>
        <div class="flex-1 min-w-0 flex items-center gap-2">
          <div class="flex-1 h-2 bg-bg1 rounded-full overflow-hidden border border-border/40">
            <div
              class="h-full rounded-full transition-all"
              style:background-color={layerMeta[currentSection.layer]?.color ?? '#6b7280'}
              style:width={barWidth(currentSection.chars)}
            ></div>
          </div>
          <span class="shrink-0 text-[10px] text-muted">{totalChars > 0 ? ((currentSection.chars / totalChars) * 100).toFixed(1) + '%' : '—'}</span>
        </div>
      </div>
    </div>

    <!-- Phase D-0e: rendered section content (real prompt text) -->
    <div class="mt-4">
      <div class="flex items-center justify-between mb-1">
        <p class="text-[10px] font-bold uppercase tracking-wide text-muted">Rendered content</p>
        <div class="flex items-center gap-2">
          {#if currentSection.content !== undefined}
            <span class="text-[9px] text-muted font-mono">{currentSection.content.length} chars</span>
            <button
              type="button"
              class="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted hover:text-foreground transition-colors cursor-pointer"
              onclick={() => (contentViewMode = contentViewMode === 'rendered' ? 'raw' : 'rendered')}
            >
              {contentViewMode === 'rendered' ? 'Raw' : 'Rendered'}
            </button>
          {/if}
        </div>
      </div>
      {#if currentSection.content === undefined}
        <div class="rounded border border-border/50 bg-bg2 px-3 py-2 text-[11px] text-muted italic">
          Gateway hasn't been updated to emit per-section content yet (D-0e #105).
          Until then, only metadata is available.
        </div>
      {:else if currentSection.content.length === 0}
        <div class="rounded border border-border/50 bg-bg2 px-3 py-2 text-[11px] text-muted italic">
          This section rendered empty for the current parameters.
        </div>
      {:else if contentViewMode === 'rendered'}
        <div class="rounded border border-border/50 bg-bg1 p-3 max-h-96 overflow-auto prompt-md">
          {#key currentSection.id}
            <MarkdownMessage value={currentSection.content} tone="assistant" />
          {/key}
        </div>
      {:else}
        <pre class="rounded border border-border/50 bg-bg1 p-3 text-[11px] font-mono text-foreground whitespace-pre-wrap break-words max-h-96 overflow-auto">{currentSection.content}</pre>
      {/if}
    </div>

    <!-- Contextual detail for known sections -->
    {#if currentSection.id === 'skills' && report.skills?.entries?.length}
      <div class="mt-4">
        <p class="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_skillBlocks()}</p>
        <div class="space-y-1">
          {#each report.skills.entries as s (s.name)}
            <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="text-accent text-[11px] shrink-0">&#x25cf;</span>
              <span class="flex-1 min-w-0 text-[11px] text-foreground truncate">{s.name}</span>
              <span class="shrink-0 text-[10px] text-muted">{fmtChars(s.blockChars)}</span>
              <div class="shrink-0 w-20 h-1.5 bg-bg1 rounded-full overflow-hidden">
                <div class="h-full bg-accent rounded-full" style:width={barWidth(s.blockChars)}></div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if currentSection.id === 'tooling' && report.tools?.entries?.length}
      <div class="mt-4">
        <p class="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_toolSchemas({ count: report.tools.entries.length })}</p>
        <div class="space-y-1">
          {#each report.tools.entries as t (t.name)}
            <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="text-accent text-[11px] shrink-0">&#x25cf;</span>
              <span class="flex-1 min-w-0 text-[11px] text-foreground truncate font-mono">{t.name}</span>
              <span class="shrink-0 text-[10px] text-muted">{m.prompt_toolProps({ count: t.propertiesCount })}</span>
              <span class="shrink-0 text-[10px] text-muted">{fmtChars(t.schemaChars)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if currentSection.id === 'project-context' && report.injectedWorkspaceFiles?.length}
      <div class="mt-4">
        <p class="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_stepBootstrap()}</p>
        <div class="space-y-1">
          {#each report.injectedWorkspaceFiles as f (f.name)}
            <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="shrink-0 text-[11px] {f.missing ? 'text-destructive' : 'text-accent'}">
                {f.missing ? '✗' : '●'}
              </span>
              <span class="flex-1 min-w-0 text-[11px] font-mono text-foreground truncate">{f.name}</span>
              {#if f.missing}
                <span class="shrink-0 text-[10px] text-destructive font-semibold">{m.prompt_fileMissing()}</span>
              {:else}
                <span class="shrink-0 text-[10px] text-muted">{fmtChars(f.injectedChars)}</span>
                {#if f.truncated}
                  <span class="shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">{m.prompt_fileTruncated()}</span>
                {:else}
                  <span class="shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded bg-green-500/10 text-green-400">{m.prompt_fileOk()}</span>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if currentSection.id === 'sandbox' && report.sandbox}
      <div class="mt-4">
        <p class="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_sandboxConfig()}</p>
        <div class="space-y-2">
          {#each [
            [m.prompt_sandboxMode(), report.sandbox.mode ?? '—'],
            [m.prompt_sandboxed(), report.sandbox.sandboxed ? m.prompt_yes() : m.prompt_no()],
          ] as [label, value] (label)}
            <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="shrink-0 w-28 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
              <span class="flex-1 min-w-0 text-[11px] text-foreground font-mono">{value}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
