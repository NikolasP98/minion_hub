<script lang="ts">
  import { Button } from '$lib/components/ui';
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
      <span class="w-2 h-2 rounded-full shrink-0" style:background-color={layerMeta[currentSection.layer]?.color ?? 'var(--color-text-tertiary)'}></span>
      <h2 class="text-sm font-semibold text-foreground">{currentSection.label}</h2>
      <span class="text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 rounded bg-bg2 border border-border/50 text-muted font-mono">{currentSection.layer}</span>
      {#if currentSection.source}
        {@const meta = SOURCE_META[currentSection.source]}
        {#if currentSection.source === 'static'}
          <Button variant="ghost"
            type="button"
            class="text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide hover:opacity-80 transition-opacity cursor-pointer"
            style={`background-color: ${meta.color}22; border: 1px solid ${meta.color}66; color: ${meta.color}`}
            title={`${meta.description} — click to edit`}
            onclick={onOpenEditor}
          >
            {meta.label} ✎
          </Button>
        {:else if currentSection.source === 'file'}
          <Button variant="ghost"
            type="button"
            class="text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide hover:opacity-80 transition-opacity cursor-pointer"
            style={`background-color: ${meta.color}22; border: 1px solid ${meta.color}66; color: ${meta.color}`}
            title={`${meta.description} — click to inspect`}
            onclick={onOpenEditor}
          >
            {meta.label} 🔍
          </Button>
        {:else}
          <span
            class="text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide"
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
    <p class="text-muted text-[length:var(--font-size-caption)] mb-3">
      {layerMeta[currentSection.layer]?.description ?? ''}
    </p>

    {#if currentSection.disabled}
      <div
        class="mb-3 flex items-center gap-2 rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-surface)] px-2 py-1.5"
      >
        <span class="text-[length:var(--font-size-caption)] text-[var(--color-warning-fg)] flex-1">This section is overridden off.</span>
        {#if onToggleDisabled}
          <Button variant="ghost"
            type="button"
            class="text-[length:var(--font-size-telemetry)] font-semibold px-2 py-0.5 rounded border border-[var(--color-warning-border)] text-[var(--color-warning-fg)] hover:bg-[var(--color-warning-surface)] transition-colors cursor-pointer"
            onclick={() => onToggleDisabled?.(currentSection.id, false)}
          >
            Reset
          </Button>
        {/if}
      </div>
    {:else if onToggleDisabled}
      <div class="mb-3">
        <Button variant="ghost"
          type="button"
          class="text-[length:var(--font-size-telemetry)] font-semibold px-2 py-0.5 rounded border border-border text-muted hover:text-foreground hover:border-accent/50 transition-colors cursor-pointer"
          onclick={() => onToggleDisabled?.(currentSection.id, true)}
        >
          Disable section
        </Button>
      </div>
    {/if}

    <!-- Section stats -->
    <div class="space-y-2">
      <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
        <span class="shrink-0 w-20 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">{m.prompt_sectionSection()}</span>
        <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground font-mono">{currentSection.id}</span>
      </div>
      <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
        <span class="shrink-0 w-20 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">{m.prompt_sectionChars()}</span>
        <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground font-semibold">{fmtChars(currentSection.chars)}</span>
      </div>
      <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
        <span class="shrink-0 w-20 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">{m.prompt_sectionOrder()}</span>
        <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground font-mono">{currentSection.order}</span>
      </div>
      {#if currentSection.bytes !== undefined}
        <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
          <span class="shrink-0 w-20 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">Bytes</span>
          <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground font-mono">{currentSection.bytes.toLocaleString()}</span>
        </div>
      {/if}
      {#if currentSection.tokens !== undefined}
        <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
          <span class="shrink-0 w-20 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">Tokens</span>
          <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground font-mono">{currentSection.tokens.toLocaleString()}</span>
        </div>
      {/if}
      {#if currentSection.cacheable !== undefined}
        <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
          <span class="shrink-0 w-20 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">Cacheable</span>
          <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] font-mono" class:text-[var(--color-warning-fg)]={currentSection.cacheable} class:text-muted={!currentSection.cacheable}>
            {currentSection.cacheable ? '⚡ yes' : 'no'}
          </span>
        </div>
      {/if}
      <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
        <span class="shrink-0 w-20 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">{m.prompt_sectionWeight()}</span>
        <div class="flex-1 min-w-0 flex items-center gap-2">
          <div class="flex-1 h-2 bg-bg1 rounded-full overflow-hidden border border-border/40">
            <div
              class="h-full rounded-full transition-all"
              style:background-color={layerMeta[currentSection.layer]?.color ?? 'var(--color-text-tertiary)'}
              style:width={barWidth(currentSection.chars)}
            ></div>
          </div>
          <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-muted">{totalChars > 0 ? ((currentSection.chars / totalChars) * 100).toFixed(1) + '%' : '—'}</span>
        </div>
      </div>
    </div>

    <!-- Phase D-0e: rendered section content (real prompt text) -->
    <div class="mt-4">
      <div class="flex items-center justify-between mb-1">
        <p class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">Rendered content</p>
        <div class="flex items-center gap-2">
          {#if currentSection.content !== undefined}
            <span class="text-[length:var(--font-size-telemetry)] text-muted font-mono">{currentSection.content.length} chars</span>
            <Button variant="ghost"
              type="button"
              class="text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 rounded border border-border text-muted hover:text-foreground transition-colors cursor-pointer"
              onclick={() => (contentViewMode = contentViewMode === 'rendered' ? 'raw' : 'rendered')}
            >
              {contentViewMode === 'rendered' ? 'Raw' : 'Rendered'}
            </Button>
          {/if}
        </div>
      </div>
      {#if currentSection.content === undefined}
        <div class="rounded border border-border/50 bg-bg2 px-3 py-2 text-[length:var(--font-size-caption)] text-muted italic">
          Gateway hasn't been updated to emit per-section content yet (D-0e var(--color-purple)).
          Until then, only metadata is available.
        </div>
      {:else if currentSection.content.length === 0}
        <div class="rounded border border-border/50 bg-bg2 px-3 py-2 text-[length:var(--font-size-caption)] text-muted italic">
          This section rendered empty for the current parameters.
        </div>
      {:else if contentViewMode === 'rendered'}
        <div class="rounded border border-border/50 bg-bg1 p-3 max-h-96 overflow-auto prompt-md">
          {#key currentSection.id}
            <MarkdownMessage value={currentSection.content} tone="assistant" />
          {/key}
        </div>
      {:else}
        <pre class="rounded border border-border/50 bg-bg1 p-3 text-[length:var(--font-size-caption)] font-mono text-foreground whitespace-pre-wrap break-words max-h-96 overflow-auto">{currentSection.content}</pre>
      {/if}
    </div>

    <!-- Contextual detail for known sections -->
    {#if currentSection.id === 'skills' && report.skills?.entries?.length}
      <div class="mt-4">
        <p class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_skillBlocks()}</p>
        <div class="space-y-1">
          {#each report.skills.entries as s (s.name)}
            <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="text-accent text-[length:var(--font-size-caption)] shrink-0">&#x25cf;</span>
              <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground truncate">{s.name}</span>
              <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-muted">{fmtChars(s.blockChars)}</span>
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
        <p class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_toolSchemas({ count: report.tools.entries.length })}</p>
        <div class="space-y-1">
          {#each report.tools.entries as t (t.name)}
            <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="text-accent text-[length:var(--font-size-caption)] shrink-0">&#x25cf;</span>
              <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground truncate font-mono">{t.name}</span>
              <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-muted">{m.prompt_toolProps({ count: t.propertiesCount })}</span>
              <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-muted">{fmtChars(t.schemaChars)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if currentSection.id === 'project-context' && report.injectedWorkspaceFiles?.length}
      <div class="mt-4">
        <p class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_stepBootstrap()}</p>
        <div class="space-y-1">
          {#each report.injectedWorkspaceFiles as f (f.name)}
            <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="shrink-0 text-[length:var(--font-size-caption)] {f.missing ? 'text-destructive' : 'text-accent'}">
                {f.missing ? '✗' : '●'}
              </span>
              <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] font-mono text-foreground truncate">{f.name}</span>
              {#if f.missing}
                <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-destructive font-semibold">{m.prompt_fileMissing()}</span>
              {:else}
                <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-muted">{fmtChars(f.injectedChars)}</span>
                {#if f.truncated}
                  <span class="shrink-0 text-[length:var(--font-size-telemetry)] font-semibold px-1 py-0.5 rounded bg-[var(--color-warning-surface)] text-[var(--color-warning-fg)]">{m.prompt_fileTruncated()}</span>
                {:else}
                  <span class="shrink-0 text-[length:var(--font-size-telemetry)] font-semibold px-1 py-0.5 rounded bg-[var(--color-success-surface)] text-[var(--color-success-fg)]">{m.prompt_fileOk()}</span>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if currentSection.id === 'sandbox' && report.sandbox}
      <div class="mt-4">
        <p class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_sandboxConfig()}</p>
        <div class="space-y-2">
          {#each [
            [m.prompt_sandboxMode(), report.sandbox.mode ?? '—'],
            [m.prompt_sandboxed(), report.sandbox.sandboxed ? m.prompt_yes() : m.prompt_no()],
          ] as [label, value] (label)}
            <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="shrink-0 w-28 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">{label}</span>
              <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground font-mono">{value}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
