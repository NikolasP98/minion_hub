<script lang="ts">
  import { Button } from '$lib/components/ui';
import SectionProseEditor from '$lib/components/agents/SectionProseEditor.svelte';
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
  import { fetchSessionPromptReport, fetchPromptPreview } from '$lib/services/gateway.svelte';
  import {
    previewSections,
    previewSectionsStream,
    getOverrides,
    setOverrides,
  } from '$lib/services/prompt-sections-rpc';
  import type { PromptMode, PreviewResponse } from '@minion-stack/shared';
  import { onDestroy } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  import ContextWindowBar from './_agent-prompt-simulator/ContextWindowBar.svelte';
  import PipelineSidebar from './_agent-prompt-simulator/PipelineSidebar.svelte';
  import SectionDetail from './_agent-prompt-simulator/SectionDetail.svelte';
  import ClassicDetail from './_agent-prompt-simulator/ClassicDetail.svelte';
  import {
    getContextWindowChars,
    cachedPct as cachedPctOf,
    sortSections,
    type BarSegment,
    type GroupMode,
    type PreviewStreamEvent,
    type SectionEntry,
    type SortMode,
    type SystemPromptReport,
  } from './_agent-prompt-simulator/types';

  let {
    agentId,
    sessionKey,
  }: {
    agentId: string;
    sessionKey: string;
  } = $props();

  const LAYER_META = $derived<Record<string, { label: string; color: string; description: string }>>({
    platform: { label: m.prompt_layerPlatform(), color: 'var(--color-text-tertiary)', description: m.prompt_layerPlatformDesc() },
    'agent-type': { label: m.prompt_layerAgentType(), color: 'var(--color-purple)', description: m.prompt_layerAgentTypeDesc() },
    identity: { label: m.prompt_layerIdentity(), color: 'var(--color-cyan)', description: m.prompt_layerIdentityDesc() },
    user: { label: m.prompt_layerUser(), color: 'var(--color-warning-fg)', description: m.prompt_layerUserDesc() },
    session: { label: m.prompt_layerSession(), color: 'var(--color-emerald)', description: m.prompt_layerSessionDesc() },
  });

  // Concrete PromptMode values. The shared PromptMode is the *assembly* mode
  // (full|minimal|none), NOT a baseline/test axis — the backend has no test-input
  // concept yet (Phase 3). Both Inspect and Simulate render the full prompt; the
  // Inspect/Simulate distinction is a UI-only framing for now.
  const PREVIEW_MODE = 'full' satisfies PromptMode;

  let report = $state<SystemPromptReport | null>(null);
  let assembled = $state<string | null>(null);
  let previewTotalBytes = $state(0);
  let previewTotalTokens = $state(0);
  let loading = $state(false);
  let testing = $state(false);
  let error = $state<string | null>(null);

  // ─── Phase 3: progressive streaming preview ─────────────────────────────
  let streaming = $state(false);
  let streamReceived = $state(0);
  let streamTotal = $state(0);
  // Monotonic run token — guards against a stale run's late events/response
  // mutating state after a newer run has started. Module-local (not reactive).
  let runToken = 0;
  let detachStream: (() => void) | null = null;

  /** Map a streamed breakdown row into a SectionEntry for the rail/hero. */
  function streamSectionToEntry(s: NonNullable<PreviewStreamEvent['section']>): SectionEntry {
    return {
      id: s.id,
      layer: s.layer,
      label: s.id,
      order: s.order,
      chars: s.bytes,
      bytes: s.bytes,
      tokens: s.tokens,
      cacheable: s.cacheable,
      source: s.source === 'builtin' ? 'static' : s.source,
      content: s.rendered,
    };
  }

  /**
   * Run a streaming preview: subscribe to per-section frames BEFORE issuing the
   * request, reveal sections as they arrive, then overwrite with the
   * authoritative final response. `testInput` is forwarded to the gateway.
   */
  async function streamPreview(testInput?: string) {
    const myToken = ++runToken;
    error = null;
    streaming = true;
    streamReceived = 0;
    streamTotal = 0;

    const built: SectionEntry[] = [];
    let buf = '';

    const onEv = (e: Event) => {
      const p = (e as CustomEvent).detail as PreviewStreamEvent;
      if (myToken !== runToken) return;
      if (p.kind === 'start') {
        streamTotal = p.total;
        return;
      }
      if (p.kind !== 'section' || !p.section) return;
      streamTotal = p.total;
      streamReceived = (p.index ?? built.length) + 1;

      const entry = streamSectionToEntry(p.section);
      const existingIdx = built.findIndex((b) => b.id === entry.id);
      if (existingIdx >= 0) built[existingIdx] = entry;
      else built.push(entry);

      // Merge into existing report.sections (preserving other report fields)
      // when a report already exists; otherwise synthesize a minimal one so the
      // hero/rail render progressively from the first frame.
      if (report) {
        const byId = new Map(built.map((b) => [b.id, b]));
        const merged: SectionEntry[] = report.sections
          ? report.sections.map((s) => {
              const b = byId.get(s.id);
              return b ? { ...s, ...b } : s;
            })
          : [];
        // Append any streamed sections the report doesn't yet know about.
        const known = new Set(merged.map((s) => s.id));
        for (const b of built) if (!known.has(b.id)) merged.push(b);
        report = { ...report, sections: merged };
      } else {
        report = { sections: [...built] };
      }

      buf += (buf ? '\n\n' : '') + p.section.rendered;
      assembled = buf;
    };

    window.addEventListener('prompt.sections.preview.event', onEv);
    detachStream = () => window.removeEventListener('prompt.sections.preview.event', onEv);

    // Merge an authoritative PreviewResponse into the assembled view + section
    // byte/token/cacheable metadata. Shared by the streaming path and the
    // non-streaming fallback below.
    const applyFinal = (res: PreviewResponse) => {
      assembled = res.assembled ?? buf;
      previewTotalBytes = res.totalBytes ?? 0;
      previewTotalTokens = res.totalTokens ?? 0;
      const byId = new Map(res.breakdown.map((b) => [b.id, b]));
      if (report?.sections) {
        report = {
          ...report,
          sections: report.sections.map((s) => {
            const b = byId.get(s.id);
            return b
              ? { ...s, bytes: b.bytes, tokens: b.tokens, cacheable: b.cacheable }
              : s;
          }),
        };
      }
    };

    try {
      const res = await previewSectionsStream(agentId, PREVIEW_MODE, testInput);
      if (myToken === runToken) applyFinal(res);
    } catch (e) {
      // Graceful degradation: gateways that predate the streaming RPC reject
      // with "unknown method". Fall back to the non-streaming preview so
      // Simulate still works (no progressive reveal, but a correct result).
      // It auto-upgrades to streaming once the gateway ships the RPC.
      const msg = (e as Error)?.message ?? '';
      if (/unknown method/i.test(msg)) {
        try {
          const res = await previewSections(agentId, PREVIEW_MODE);
          if (myToken === runToken) applyFinal(res);
        } catch (e2) {
          if (myToken === runToken) {
            error = (e2 as Error).message ?? 'Failed to generate prompt preview';
          }
        }
      } else if (myToken === runToken) {
        error = msg || 'Failed to generate prompt preview';
      }
    } finally {
      detachStream?.();
      detachStream = null;
      if (myToken === runToken) {
        streaming = false;
        loading = false;
        testing = false;
      }
    }
  }

  onDestroy(() => {
    runToken++;
    detachStream?.();
    detachStream = null;
  });

  // ─── Lens state (group + sort), persisted to localStorage ───────────────
  function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
    if (typeof localStorage === 'undefined') return fallback;
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  }
  // svelte-ignore state_referenced_locally
  let groupMode = $state<GroupMode>(readPref('minion.promptTab.group', 'layer', ['layer', 'none', 'pipeline']));
  // svelte-ignore state_referenced_locally
  let sortMode = $state<SortMode>(readPref('minion.promptTab.sort', 'order', ['order', 'cached', 'alpha', 'size']));
  $effect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('minion.promptTab.group', groupMode);
  });
  $effect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('minion.promptTab.sort', sortMode);
  });

  // ─── Inspect / Simulate context ─────────────────────────────────────────
  let viewContext = $state<'inspect' | 'simulate'>('inspect');
  let testPrompt = $state("Tell me about today's schedule.");
  let lastRunPrompt = $state('');
  const testDirty = $derived(viewContext === 'simulate' && testPrompt !== lastRunPrompt);

  // ─── Selection / inspector slide-over ───────────────────────────────────
  let selectedSectionId = $state<string | null>(null);
  let activeStep = $state(0);
  let contentViewMode = $state<'rendered' | 'raw'>('rendered');
  let editorOpen = $state(false);
  let railOpenMobile = $state(false);

  // ─── Overrides ──────────────────────────────────────────────────────────
  let disabledIds = $state<Set<string>>(new Set());

  const CLASSIC_STEPS = $derived([
    { id: 'bootstrap', label: m.prompt_stepBootstrap() },
    { id: 'parameters', label: m.prompt_stepParameters() },
    { id: 'skills', label: m.prompt_stepSkills() },
    { id: 'sandbox', label: m.prompt_stepSandbox() },
    { id: 'tools', label: m.prompt_stepTools() },
    { id: 'memory', label: m.prompt_stepMemory() },
    { id: 'tts', label: m.prompt_stepTts() },
    { id: 'assembly', label: m.prompt_stepAssembly() },
    { id: 'post-turn', label: m.prompt_stepPostTurn() },
  ]);

  const hasSections = $derived(!!(report?.sections && report.sections.length > 0));

  // All sections that render to something, with override-disabled flag applied.
  const allSections = $derived<SectionEntry[]>(
    (report?.sections ?? [])
      .filter((s) => s.chars > 0 || (s.bytes ?? 0) > 0)
      .map((s) => ({ ...s, disabled: disabledIds.has(s.id) })),
  );

  const totalCount = $derived(allSections.length);

  // Sections passed to the rail (no filtering yet — full set; sorting happens in rail).
  const visibleSections = $derived(allSections);

  const selectedSection = $derived(
    selectedSectionId ? (allSections.find((s) => s.id === selectedSectionId) ?? null) : null,
  );

  // Assembled blocks for the hero pane (ordered).
  const orderedSections = $derived(sortSections(allSections, 'order'));
  const firstCacheableId = $derived(orderedSections.find((s) => s.cacheable)?.id ?? null);

  const aggCachedPct = $derived(cachedPctOf(allSections));

  $effect(() => {
    const sk = sessionKey;
    const _aid = agentId;
    void loadAll(sk);
  });

  async function loadOverrides() {
    try {
      const res = await getOverrides(agentId);
      disabledIds = new Set(res.disabled);
    } catch (e) {
      console.warn('[prompt] getOverrides failed:', e);
    }
  }

  /** Merge `previewSections` breakdown (bytes/tokens/cacheable) into report.sections by id. */
  async function enrich(mode: PromptMode) {
    try {
      const preview = await previewSections(agentId, mode);
      assembled = preview.assembled ?? null;
      previewTotalBytes = preview.totalBytes ?? 0;
      previewTotalTokens = preview.totalTokens ?? 0;
      const byId = new Map(preview.breakdown.map((b) => [b.id, b]));
      if (report?.sections) {
        report = {
          ...report,
          sections: report.sections.map((s) => {
            const b = byId.get(s.id);
            return b
              ? { ...s, bytes: b.bytes, tokens: b.tokens, cacheable: b.cacheable }
              : s;
          }),
        };
      }
    } catch (e) {
      console.warn('[prompt] previewSections enrich failed (degraded view):', e);
    }
  }

  async function loadAll(sk: string) {
    loading = true;
    error = null;
    report = null;
    assembled = null;
    selectedSectionId = null;
    try {
      const res = (await fetchSessionPromptReport(sk)) as {
        sessions?: Array<{ contextWeight?: SystemPromptReport }>;
      } | null;
      const first = res?.sessions?.[0];
      report = first?.contextWeight ?? null;

      // Backfill section content from prompt.preview when missing.
      if (report?.sections && report.sections.some((s) => s.content === undefined)) {
        try {
          const fresh = (await fetchPromptPreview(agentId)) as SystemPromptReport | null;
          if (fresh?.sections) {
            const freshById = new Map(fresh.sections.map((s) => [s.id, s]));
            report = {
              ...report,
              sections: report.sections.map((s) => {
                if (s.content !== undefined) return s;
                const live = freshById.get(s.id);
                return live ? { ...s, content: live.content, source: s.source ?? live.source } : s;
              }),
            };
          }
        } catch (e) {
          console.warn('[prompt] content backfill failed:', e);
        }
      }

      await Promise.all([enrich(PREVIEW_MODE), loadOverrides()]);
    } catch (e) {
      error = (e as Error).message ?? 'Failed to load prompt report';
    } finally {
      loading = false;
    }
  }

  async function refreshReportSilently() {
    try {
      const res = (await fetchPromptPreview(agentId)) as SystemPromptReport | null;
      if (res) report = res;
      await enrich(PREVIEW_MODE);
    } catch (e) {
      console.warn('[prompt] silent refresh failed:', e);
    }
  }

  async function runTest() {
    testing = true;
    error = null;
    lastRunPrompt = testPrompt;
    // Phase 3: stream the rendered prompt section-by-section instead of a
    // spinner. The test text is forwarded to the gateway. `streamPreview` clears
    // `testing` in its finally block.
    await streamPreview(testPrompt.trim() || undefined);
  }

  function setViewContext(ctx: 'inspect' | 'simulate') {
    if (viewContext === ctx) return;
    viewContext = ctx;
    void enrich(PREVIEW_MODE);
  }

  // ─── Override toggle (optimistic, with rollback) ────────────────────────
  async function onToggleSection(id: string, disabled: boolean) {
    const prev = new Set(disabledIds);
    const next = new Set(disabledIds);
    if (disabled) next.add(id);
    else next.delete(id);
    disabledIds = next;
    try {
      await setOverrides(agentId, [...next]);
      await enrich(PREVIEW_MODE);
    } catch (e) {
      console.warn('[prompt] setOverrides failed, rolling back:', e);
      disabledIds = prev;
    }
  }

  function selectSection(id: string) {
    selectedSectionId = id;
    const el = document.getElementById(`assembled-section-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeInspector() {
    selectedSectionId = null;
  }

  function onSelectStep(idx: number) {
    activeStep = idx;
    selectedSectionId = '__stage__';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && selectedSectionId) {
      closeInspector();
    }
  }

  // ─── Context-window budget bar ──────────────────────────────────────────
  const totalChars = $derived(report?.systemPrompt?.chars ?? 0);
  const contextWindowChars = $derived(getContextWindowChars(report?.model));

  const segments = $derived.by<BarSegment[]>(() => {
    if (!report) return [];
    if (hasSections && report.sections) {
      const layerChars = new Map<string, number>();
      for (const s of report.sections) {
        if (s.chars > 0) layerChars.set(s.layer, (layerChars.get(s.layer) ?? 0) + s.chars);
      }
      const segs: BarSegment[] = [];
      for (const [layer, chars] of layerChars) {
        const meta = LAYER_META[layer];
        if (meta && chars > 0) segs.push({ label: meta.label, chars, color: meta.color, layer });
      }
      return segs;
    }
    const bootstrapChars =
      report.injectedWorkspaceFiles?.reduce((s, f) => s + (f.injectedChars ?? 0), 0) ?? 0;
    const skillsChars = report.skills?.promptChars ?? 0;
    const toolsChars = (report.tools?.listChars ?? 0) + (report.tools?.schemaChars ?? 0);
    const systemTotal = report.systemPrompt?.chars ?? 0;
    const coreChars = Math.max(0, systemTotal - bootstrapChars - skillsChars - toolsChars);
    const segs: BarSegment[] = [];
    if (coreChars > 0) segs.push({ label: 'Core', chars: coreChars, color: 'var(--color-text-tertiary)' });
    if (bootstrapChars > 0) segs.push({ label: 'Bootstrap', chars: bootstrapChars, color: 'var(--color-cyan)' });
    if (skillsChars > 0) segs.push({ label: 'Skills', chars: skillsChars, color: 'var(--color-purple)' });
    if (toolsChars > 0) segs.push({ label: 'Tools', chars: toolsChars, color: 'var(--color-warning-fg)' });
    return segs;
  });

  const totalUsedChars = $derived(segments.reduce((s, seg) => s + seg.chars, 0));
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col h-full overflow-hidden text-[length:var(--font-size-caption)]">
  <!-- Topbar: Inspect / Simulate + budget bar -->
  <div class="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg2">
    <div class="flex rounded border border-border overflow-hidden">
      <Button variant="ghost"
        type="button"
        class="text-[length:var(--font-size-telemetry)] px-2.5 py-1 transition-colors cursor-pointer
          {viewContext === 'inspect' ? 'bg-accent/15 text-accent font-semibold' : 'text-muted hover:text-foreground'}"
        onclick={() => setViewContext('inspect')}
      >
        Inspect
      </Button>
      <Button variant="ghost"
        type="button"
        class="text-[length:var(--font-size-telemetry)] px-2.5 py-1 transition-colors cursor-pointer flex items-center gap-1
          {viewContext === 'simulate' ? 'bg-accent/15 text-accent font-semibold' : 'text-muted hover:text-foreground'}"
        onclick={() => setViewContext('simulate')}
      >
        Simulate
        {#if testDirty}
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-warning-surface)]" title="Unsaved test input"></span>
        {/if}
      </Button>
    </div>
    {#if previewTotalTokens > 0}
      <span class="text-[length:var(--font-size-telemetry)] font-mono text-foreground/40 tabular-nums">{previewTotalTokens.toLocaleString()} tok</span>
    {/if}
  </div>

  {#if report}
    <ContextWindowBar
      {segments}
      {contextWindowChars}
      {totalUsedChars}
      cachedPct={aggCachedPct}
      onToggleRail={() => (railOpenMobile = !railOpenMobile)}
    />
  {/if}

  <div class="relative flex flex-1 min-h-0 overflow-hidden">
    <!-- Sections rail: fixed 280px on lg, drawer below -->
    <div
      class="hidden lg:flex w-[280px] shrink-0 min-h-0"
    >
      <PipelineSidebar
        bind:groupMode
        bind:sortMode
        {viewContext}
        {hasSections}
        {selectedSectionId}
        layerMeta={LAYER_META}
        sections={visibleSections}
        classicSteps={CLASSIC_STEPS}
        {activeStep}
        stepStatus={{}}
        bind:testPrompt
        {testing}
        {loading}
        {disabledIds}
        {totalCount}
        onSelectSection={selectSection}
        {onSelectStep}
        {onToggleSection}
        onRunTest={runTest}
        onRefresh={() => loadAll(sessionKey)}
      />
    </div>

    <!-- Mobile drawer -->
    {#if railOpenMobile}
      <Button variant="ghost"
        type="button"
        class="lg:hidden absolute inset-0 z-[var(--layer-navigation)] bg-[color-mix(in_srgb,var(--color-canvas)_40%,transparent)]"
        aria-label="Close sections"
        onclick={() => (railOpenMobile = false)}
      ></Button>
      <div class="lg:hidden absolute left-0 top-0 bottom-0 z-[var(--layer-dropdown)] w-[280px] shadow-xl">
        <PipelineSidebar
          bind:groupMode
          bind:sortMode
          {viewContext}
          {hasSections}
          {selectedSectionId}
          layerMeta={LAYER_META}
          sections={visibleSections}
          classicSteps={CLASSIC_STEPS}
          {activeStep}
          stepStatus={{}}
          bind:testPrompt
          {testing}
          {loading}
          {disabledIds}
          {totalCount}
          onSelectSection={(id) => {
            selectSection(id);
            railOpenMobile = false;
          }}
          {onSelectStep}
          {onToggleSection}
          onRunTest={runTest}
          onRefresh={() => loadAll(sessionKey)}
        />
      </div>
    {/if}

    <!-- Assembled hero -->
    <div class="relative flex-1 min-w-0 overflow-y-auto bg-bg">
      {#if (loading || testing || streaming) && !(report?.sections?.length)}
        <!-- Spinner only pre-first-byte; once sections arrive the stream renders. -->
        <div class="flex items-center justify-center h-full gap-2 text-muted text-xs">
          <div class="w-4 h-4 border-2 border-border border-t-accent rounded-full animate-spin"></div>
          {testing || streaming ? m.prompt_generatingPreview() : m.prompt_loadingReport()}
        </div>
      {:else if error}
        <div class="flex flex-col items-center justify-center h-full gap-3">
          <span class="text-destructive text-xs">{m.prompt_couldNotLoad()}</span>
          <span class="text-muted text-[length:var(--font-size-caption)]">{error}</span>
          <Button variant="ghost"
            type="button"
            class="text-[length:var(--font-size-caption)] font-semibold px-3 py-1.5 rounded border border-border text-muted hover:text-foreground transition-colors cursor-pointer"
            onclick={() => loadAll(sessionKey)}
          >
            {m.common_retry()}
          </Button>
        </div>
      {:else if !report}
        <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
          <span class="text-muted text-xs">{m.prompt_noReport()}</span>
          <span class="text-muted text-[length:var(--font-size-caption)]">{m.prompt_noReportHint()}</span>
        </div>
      {:else if groupMode === 'pipeline'}
        <ClassicDetail {activeStep} {report} {totalChars} />
      {:else}
        <!-- Assembled rendered prompt -->
        <div class="p-4 max-w-3xl mx-auto space-y-3">
          {#if streaming}
            <!-- Phase 3: live build progress while sections stream in. -->
            <div class="flex items-center gap-2">
              <div class="flex-1 h-0.5 rounded-full bg-border/60 overflow-hidden">
                <div
                  class="h-full bg-accent transition-[width] duration-[var(--duration-fast)] ease-out"
                  style:width="{streamTotal > 0 ? Math.round((streamReceived / streamTotal) * 100) : 5}%"
                ></div>
              </div>
              <span class="text-[length:var(--font-size-telemetry)] font-mono text-accent/80 tabular-nums shrink-0">
                Building {streamReceived}{streamTotal > 0 ? `/${streamTotal}` : ''}
              </span>
            </div>
          {/if}
          <div class="flex items-center justify-between">
            <h2 class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-widest text-muted">Assembled prompt</h2>
            {#if previewTotalTokens > 0}
              <span class="text-[length:var(--font-size-telemetry)] font-mono text-foreground/40 tabular-nums">{previewTotalTokens.toLocaleString()} tokens · {previewTotalBytes.toLocaleString()} bytes</span>
            {/if}
          </div>
          {#if assembled}
            <div class="rounded border border-border/50 bg-bg1 p-4 prompt-md">
              <MarkdownMessage value={assembled} tone="assistant" />
            </div>
          {:else}
            <!-- Fall back to per-section content blocks -->
            <div class="space-y-3">
              {#each orderedSections as section (section.id)}
                {#if firstCacheableId === section.id}
                  <div class="flex items-center gap-2 py-1" role="separator">
                    <span class="flex-1 border-t border-dashed border-[var(--color-warning-border)]"></span>
                    <span class="text-[length:var(--font-size-telemetry)] uppercase tracking-widest text-[var(--color-warning-fg)]/70 font-mono">⚡ cacheable boundary</span>
                    <span class="flex-1 border-t border-dashed border-[var(--color-warning-border)]"></span>
                  </div>
                {/if}
                <div
                  id="assembled-section-{section.id}"
                  class="rounded border bg-bg1 p-3 scroll-mt-4 transition-colors
                    {selectedSectionId === section.id ? 'border-accent/60' : 'border-border/50'}
                    {section.disabled ? 'opacity-40' : ''}"
                >
                  <div class="flex items-center gap-2 mb-1.5">
                    <span class="w-1.5 h-1.5 rounded-full shrink-0" style:background-color={LAYER_META[section.layer]?.color ?? 'var(--color-text-tertiary)'}></span>
                    <span class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted flex-1">{section.label}</span>
                    {#if section.cacheable}<span class="text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]" title="Cacheable">⚡</span>{/if}
                  </div>
                  {#if section.content}
                    <div class="prompt-md text-[length:var(--font-size-caption)]">
                      <MarkdownMessage value={section.content} tone="assistant" />
                    </div>
                  {:else}
                    <p class="text-[length:var(--font-size-caption)] text-muted italic">— no rendered content available</p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Inspector slide-over -->
      {#if report && (selectedSection || (selectedSectionId === '__stage__' && groupMode === 'pipeline'))}
        <Button variant="ghost"
          type="button"
          class="absolute inset-0 z-[var(--layer-sticky)] bg-transparent cursor-default"
          aria-label="Close inspector"
          onclick={closeInspector}
        ></Button>
        <aside
          class="absolute right-0 top-0 bottom-0 z-[var(--layer-navigation)] w-[320px] max-w-[85%] bg-bg2 border-l border-border shadow-2xl overflow-y-auto prompt-slideover"
        >
          <div class="sticky top-0 z-[var(--layer-sticky)] flex items-center justify-between px-3 py-2 border-b border-border bg-bg2">
            <span class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-widest text-muted">Inspector</span>
            <Button variant="ghost"
              type="button"
              class="text-muted hover:text-foreground transition-colors cursor-pointer text-sm leading-none px-1"
              onclick={closeInspector}
              aria-label="Close"
            >
              ✕
            </Button>
          </div>
          {#if selectedSectionId === '__stage__' && groupMode === 'pipeline'}
            <ClassicDetail {activeStep} {report} {totalChars} />
          {:else if selectedSection && report}
            <SectionDetail
              currentSection={selectedSection}
              {report}
              layerMeta={LAYER_META}
              {totalChars}
              bind:contentViewMode
              onOpenEditor={() => (editorOpen = true)}
              onToggleDisabled={onToggleSection}
            />
          {/if}
        </aside>
      {/if}
    </div>
  </div>
</div>

{#if selectedSection && (selectedSection.source === 'static' || selectedSection.source === 'file')}
  <SectionProseEditor
    bind:open={editorOpen}
    {agentId}
    layer={selectedSection.layer as 'platform' | 'agent-type' | 'identity' | 'user' | 'session'}
    sectionId={selectedSection.id}
    sectionLabel={selectedSection.label}
    mode={selectedSection.source === 'file' ? 'fileInspector' : 'prose'}
    onSaved={() => {
      void refreshReportSilently();
    }}
  />
{/if}

<style>
  .prompt-slideover {
    animation: slide-in 200ms ease-out;
  }
  @keyframes slide-in {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }
</style>
