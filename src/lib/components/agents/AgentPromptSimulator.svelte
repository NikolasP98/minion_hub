<script lang="ts">
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
  import SectionProseEditor from '$lib/components/agents/SectionProseEditor.svelte';
  import { fetchSessionPromptReport, fetchPromptPreview } from '$lib/services/gateway.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    agentId,
    sessionKey,
  }: {
    agentId: string;
    sessionKey: string;
  } = $props();

  // ─── Types ────────────────────────────────────────────────────────────────

  interface WorkspaceFile {
    name: string;
    path?: string;
    missing: boolean;
    rawChars: number;
    injectedChars: number;
    truncated: boolean;
  }

  interface SkillEntry {
    name: string;
    blockChars: number;
  }

  interface ToolEntry {
    name: string;
    summaryChars: number;
    schemaChars: number;
    propertiesCount: number;
  }

  interface SandboxConfig {
    enabled?: boolean;
    workspaceAccess?: boolean;
    containerDir?: string;
    mode?: string;
    sandboxed?: boolean;
  }

  interface SectionEntry {
    id: string;
    layer: string;
    label: string;
    chars: number;
    order: number;
    /** Phase D-0e: rendered text content (gateway-side D-0e #105). May be
     * undefined if the gateway hasn't been updated yet — UI shows a notice. */
    content?: string;
    /** Phase D-0e/f: where this section's content originates. */
    source?: 'static' | 'file' | 'generated' | 'config' | 'custom';
  }

  const SOURCE_META: Record<
    NonNullable<SectionEntry['source']>,
    { label: string; color: string; description: string }
  > = {
    static: {
      label: 'Static',
      color: '#6b7280',
      description: 'Hardcoded boilerplate in the gateway section definition.',
    },
    file: {
      label: 'File',
      color: '#06b6d4',
      description: 'Loaded from an agent workspace file (bootstrap or project docs).',
    },
    generated: {
      label: 'Generated',
      color: '#8b5cf6',
      description: 'Produced at request time from runtime state (skills, memory, workspace, time).',
    },
    config: {
      label: 'Config',
      color: '#f59e0b',
      description: 'User-configurable per-agent setting (personality, sandbox, permissions).',
    },
    custom: {
      label: 'Custom',
      color: '#10b981',
      description: 'User-authored YAML section from Phase 19 customisation.',
    },
  };

  interface SystemPromptReport {
    source?: string;
    generatedAt?: number;
    model?: string;
    provider?: string;
    workspaceDir?: string;
    bootstrapMaxChars?: number;
    bootstrapTotalMaxChars?: number;
    sandbox?: SandboxConfig;
    systemPrompt?: {
      chars: number;
      projectContextChars: number;
      nonProjectContextChars: number;
    };
    injectedWorkspaceFiles?: WorkspaceFile[];
    skills?: {
      promptChars: number;
      entries: SkillEntry[];
    };
    tools?: {
      listChars: number;
      schemaChars: number;
      entries: ToolEntry[];
    };
    sections?: SectionEntry[];
  }

  // ─── Layer metadata ──────────────────────────────────────────────────────

  const LAYER_META = $derived<Record<string, { label: string; color: string; description: string }>>({
    platform: { label: m.prompt_layerPlatform(), color: '#6b7280', description: m.prompt_layerPlatformDesc() },
    'agent-type': { label: m.prompt_layerAgentType(), color: '#8b5cf6', description: m.prompt_layerAgentTypeDesc() },
    identity: { label: m.prompt_layerIdentity(), color: '#06b6d4', description: m.prompt_layerIdentityDesc() },
    user: { label: m.prompt_layerUser(), color: '#f59e0b', description: m.prompt_layerUserDesc() },
    session: { label: m.prompt_layerSession(), color: '#10b981', description: m.prompt_layerSessionDesc() },
  });

  // ─── State ────────────────────────────────────────────────────────────────

  let report = $state<SystemPromptReport | null>(null);
  let loading = $state(false);
  let testing = $state(false);
  let error = $state<string | null>(null);
  let activeStep = $state(0);
  /** 'sections' = per-section view, 'classic' = old aggregated view */
  let viewMode = $state<'sections' | 'classic'>('sections');

  // ─── Phase D-0d: stepped Test playback ─────────────────────────────────
  // Per-step status during animated playback after Test is clicked.
  // 'pending' = not yet reached, 'loading' = currently processing,
  // 'ok' = completed with content, 'missing' = completed but section produced
  // no content. When `stepStatus` is empty (default), legacy non-animated
  // rendering is used; the animator sets entries during runTest.
  let stepStatus = $state<Record<string, 'pending' | 'loading' | 'ok' | 'missing'>>({});
  let testPrompt = $state('Tell me about today\'s schedule.');
  /** Per-step delay during animated playback. */
  const STEP_ANIMATION_MS = 220;

  /** Phase D-0e: toggle for rendered-content panel between markdown and raw. */
  let contentViewMode = $state<'rendered' | 'raw'>('rendered');

  /** Phase D-0f: prose-editor modal state. */
  let editorOpen = $state(false);

  // ─── Pipeline steps ──────────────────────────────────────────────────────

  // Classic fallback steps when sections data is not available
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

  // Active sections are the ones that actually produced content
  const activeSections = $derived(
    report?.sections?.filter((s) => s.chars > 0) ?? [],
  );

  /** Phase D-0f: top-level reference to the currently-focused section so the
   * editor modal (rendered outside the template's section-detail scope) can
   * read its id/layer/source. */
  const currentSectionTop = $derived(activeSections[activeStep] ?? null);

  const currentSteps = $derived(
    viewMode === 'sections' && hasSections
      ? activeSections.map((s) => ({ id: s.id, label: s.label, layer: s.layer, chars: s.chars }))
      : CLASSIC_STEPS.map((s) => ({ id: s.id, label: s.label, layer: undefined as string | undefined, chars: undefined as number | undefined })),
  );

  // ─── Data loading ─────────────────────────────────────────────────────────

  $effect(() => {
    const sk = sessionKey;
    const _aid = agentId; // track agentId for reactive reload
    loadReport(sk);
  });

  async function loadReport(sk: string) {
    loading = true;
    error = null;
    report = null;
    try {
      const res = (await fetchSessionPromptReport(sk)) as {
        sessions?: Array<{ contextWeight?: SystemPromptReport }>;
      } | null;
      const first = res?.sessions?.[0];
      report = first?.contextWeight ?? null;
    } catch (e) {
      error = (e as Error).message ?? 'Failed to load prompt report';
    } finally {
      loading = false;
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Phase D-0f-1.5: silent refresh after a prose edit. Re-fetches the
   * preview and updates `report` in place, leaving the animation state
   * (stepStatus, activeStep) untouched so the user keeps their current
   * focused section. Used by the editor modal's onSaved callback.
   */
  async function refreshReportSilently() {
    try {
      const res = (await fetchPromptPreview(agentId)) as SystemPromptReport | null;
      if (res) {
        report = res;
      }
    } catch (e) {
      // Don't surface errors here — the user explicitly saved, the prompt
      // panel just becomes momentarily stale. Re-running Test will recover.
      console.warn('[prompt] silent refresh failed:', e);
    }
  }

  async function runTest() {
    testing = true;
    error = null;
    report = null;
    stepStatus = {};
    activeStep = 0;
    try {
      // Phase D-0d: fetch the full prompt preview, then animate the pipeline
      // sidebar one step at a time so each step renders as if it were its
      // own mini-prompt to an LLM. The data is real; the stepping is a
      // client-side playback. A real-events upgrade is a future enhancement.
      const res = (await fetchPromptPreview(agentId)) as SystemPromptReport | null;
      report = res;
      if (res?.sections && res.sections.length > 0) {
        viewMode = 'sections';
      }

      // Capture step list AFTER report is set so currentSteps reflects sections.
      // Use a microtask to let derived currentSteps recompute.
      await sleep(0);
      const stepsToPlay = currentSteps;
      // Mark all pending up front so the sidebar shows an explicit playback queue.
      const initialStatus: Record<string, 'pending' | 'loading' | 'ok' | 'missing'> = {};
      for (const s of stepsToPlay) initialStatus[s.id] = 'pending';
      stepStatus = initialStatus;

      // Walk steps sequentially: pending → loading (active) → ok/missing.
      for (let i = 0; i < stepsToPlay.length; i += 1) {
        const step = stepsToPlay[i];
        if (!step) continue;
        activeStep = i;
        stepStatus = { ...stepStatus, [step.id]: 'loading' };
        await sleep(STEP_ANIMATION_MS);
        const hasContent =
          step.chars === undefined ? true : (step.chars ?? 0) > 0;
        stepStatus = {
          ...stepStatus,
          [step.id]: hasContent ? 'ok' : 'missing',
        };
      }
    } catch (e) {
      error = (e as Error).message ?? 'Failed to generate prompt preview';
    } finally {
      testing = false;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function stepIcon(stepId: string): string {
    const status = stepStatus[stepId];
    if (!status) return '';
    if (status === 'pending') return '○';
    if (status === 'loading') return '⏳';
    if (status === 'ok') return '✓';
    return '×';
  }

  function stepStatusClass(stepId: string): string {
    const status = stepStatus[stepId];
    if (status === 'loading') return 'text-accent animate-pulse';
    if (status === 'ok') return 'text-emerald-400';
    if (status === 'missing') return 'text-rose-400';
    if (status === 'pending') return 'text-foreground/30';
    return '';
  }

  function fmtChars(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
    return `${n} chars`;
  }

  function fmtDate(ms?: number): string {
    if (!ms) return '—';
    try {
      return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return String(ms);
    }
  }

  // Total chars for size bar denominator (assembly total)
  const totalChars = $derived(report?.systemPrompt?.chars ?? 0);

  function barWidth(chars: number): string {
    if (!totalChars || chars <= 0) return '0%';
    return `${Math.min((chars / totalChars) * 100, 100).toFixed(1)}%`;
  }

  // ─── Context window bar ───────────────────────────────────────────────────

  interface BarSegment {
    label: string;
    chars: number;
    color: string;
    layer?: string;
  }

  function getContextWindowChars(model: string | undefined): number {
    if (!model) return 800_000;
    const m = model.toLowerCase();
    if (m.includes('claude')) return 800_000;
    if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 512_000;
    if (m.includes('gpt-4')) return 32_768;
    if (m.includes('gpt-3.5-turbo-16k')) return 65_536;
    if (m.includes('gpt-3.5')) return 16_384;
    if (m.includes('gemini-1.5')) return 4_000_000;
    if (m.includes('gemini')) return 400_000;
    return 800_000;
  }

  const contextWindowChars = $derived(getContextWindowChars(report?.model));

  const segments = $derived.by<BarSegment[]>(() => {
    if (!report) return [];

    // If we have sections, build segments per layer
    if (hasSections && report.sections) {
      const layerChars = new Map<string, number>();
      for (const s of report.sections) {
        if (s.chars > 0) {
          layerChars.set(s.layer, (layerChars.get(s.layer) ?? 0) + s.chars);
        }
      }
      const segs: BarSegment[] = [];
      for (const [layer, chars] of layerChars) {
        const meta = LAYER_META[layer];
        if (meta && chars > 0) {
          segs.push({ label: meta.label, chars, color: meta.color, layer });
        }
      }
      return segs;
    }

    // Classic fallback
    const bootstrapChars =
      report.injectedWorkspaceFiles?.reduce((s, f) => s + (f.injectedChars ?? 0), 0) ?? 0;
    const skillsChars = report.skills?.promptChars ?? 0;
    const toolsChars = (report.tools?.listChars ?? 0) + (report.tools?.schemaChars ?? 0);
    const systemTotal = report.systemPrompt?.chars ?? 0;
    const coreChars = Math.max(0, systemTotal - bootstrapChars - skillsChars - toolsChars);
    const segs: BarSegment[] = [];
    if (coreChars > 0) segs.push({ label: 'Core', chars: coreChars, color: '#6b7280' });
    if (bootstrapChars > 0) segs.push({ label: 'Bootstrap', chars: bootstrapChars, color: '#06b6d4' });
    if (skillsChars > 0) segs.push({ label: 'Skills', chars: skillsChars, color: '#8b5cf6' });
    if (toolsChars > 0) segs.push({ label: 'Tools', chars: toolsChars, color: '#f59e0b' });
    return segs;
  });

  const totalUsedChars = $derived(segments.reduce((s, seg) => s + seg.chars, 0));

  function fmtContextPct(chars: number): string {
    if (!contextWindowChars) return '';
    return `${((chars / contextWindowChars) * 100).toFixed(1)}%`;
  }

  // ─── Section detail rendering helpers ─────────────────────────────────────

  function getSectionLayer(stepIdx: number): string | undefined {
    return currentSteps[stepIdx]?.layer;
  }

  function getSectionColor(stepIdx: number): string {
    const layer = getSectionLayer(stepIdx);
    if (layer && LAYER_META[layer]) return LAYER_META[layer].color;
    return '#6b7280';
  }
</script>

<div class="flex flex-col h-full overflow-hidden text-[12px]">

  <!-- ─── Context Window Bar (persistent across all steps) ─────────────── -->
  {#if report}
    <div class="shrink-0 border-b border-border bg-bg2 px-3 pt-2 pb-2 space-y-1.5">
      <!-- Stacked bar -->
      <div class="relative h-2.5 bg-bg1 rounded-sm overflow-hidden border border-border/40 flex">
        {#each segments as seg (seg.label)}
          <div
            class="h-full shrink-0 transition-all duration-300"
            style:background-color={seg.color}
            style:width="{((seg.chars / contextWindowChars) * 100).toFixed(2)}%"
          ></div>
        {/each}
      </div>

      <!-- Legend row -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0 flex-wrap">
          {#each segments as seg (seg.label)}
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-sm shrink-0" style:background-color={seg.color}></span>
              <span class="text-[10px] text-muted">{seg.label}</span>
              <span class="text-[10px] text-foreground/50">{fmtChars(seg.chars)}</span>
            </span>
          {/each}
        </div>
        <span class="shrink-0 text-[10px] font-mono text-muted whitespace-nowrap">
          {fmtChars(totalUsedChars)} / {fmtChars(contextWindowChars)}
          <span class="text-foreground/60">&middot; {fmtContextPct(totalUsedChars)}</span>
        </span>
      </div>
    </div>
  {/if}

  <!-- ─── Sidebar + Detail ───────────────────────────────────────────────── -->
  <div class="flex flex-1 min-h-0 overflow-hidden">
  <!-- Sidebar -->
  <div class="w-[200px] shrink-0 border-r border-border bg-bg2 overflow-y-auto flex flex-col">
    <div class="px-3 py-2 border-b border-border flex items-center justify-between">
      <span class="text-[10px] font-bold uppercase tracking-widest text-muted">{m.prompt_pipeline()}</span>
      {#if hasSections}
        <button
          type="button"
          class="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted hover:text-foreground transition-colors cursor-pointer"
          onclick={() => { viewMode = viewMode === 'sections' ? 'classic' : 'sections'; activeStep = 0; }}
        >
          {viewMode === 'sections' ? m.prompt_classic() : m.prompt_sections()}
        </button>
      {/if}
    </div>

    {#if viewMode === 'sections' && hasSections}
      <!-- Sections view: grouped by layer -->
      <div class="flex-1 py-1">
        {#each Object.entries(LAYER_META) as [layerId, meta] (layerId)}
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
                onclick={() => (activeStep = stepIdx)}
              >
                {#if stepStatus[section.id]}
                  <span class={`shrink-0 w-3 text-center text-[11px] font-mono ${stepStatusClass(section.id)}`}>
                    {stepIcon(section.id)}
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
        {#each CLASSIC_STEPS as step, i (step.id)}
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer
              {activeStep === i
              ? 'bg-accent/10 border-l-2 border-accent text-foreground'
              : 'border-l-2 border-transparent text-muted hover:text-foreground hover:bg-white/[0.03]'}"
            onclick={() => (activeStep = i)}
          >
            <span
              class="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold
                {activeStep === i ? 'bg-accent text-white' : 'bg-bg1 text-muted border border-border'}"
            >
              {i + 1}
            </span>
            <span class="text-[11px] font-medium truncate">{step.label}</span>
            {#if stepStatus[step.id]}
              <span class={`shrink-0 ml-auto text-[11px] font-mono ${stepStatusClass(step.id)}`}>
                {stepIcon(step.id)}
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
        onclick={runTest}
        disabled={testing || loading || !testPrompt.trim()}
      >
        {testing ? m.prompt_generating() : m.prompt_test()}
      </button>
      <button
        type="button"
        class="w-full text-[10px] font-semibold px-2 py-1 rounded border border-border text-muted hover:text-foreground hover:border-accent/50 transition-colors cursor-pointer"
        onclick={() => loadReport(sessionKey)}
        disabled={loading || testing}
      >
        {loading ? m.common_loading() : m.prompt_refresh()}
      </button>
    </div>
  </div>

  <!-- Detail panel -->
  <div class="flex-1 min-w-0 overflow-y-auto bg-bg">
    {#if loading || testing}
      <div class="flex items-center justify-center h-full gap-2 text-muted text-xs">
        <div class="w-4 h-4 border-2 border-border border-t-accent rounded-full animate-spin"></div>
        {testing ? m.prompt_generatingPreview() : m.prompt_loadingReport()}
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center h-full gap-3">
        <span class="text-destructive text-xs">{m.prompt_couldNotLoad()}</span>
        <span class="text-muted text-[11px]">{error}</span>
        <button
          type="button"
          class="text-[11px] font-semibold px-3 py-1.5 rounded border border-border text-muted hover:text-foreground transition-colors cursor-pointer"
          onclick={() => loadReport(sessionKey)}
        >
          {m.common_retry()}
        </button>
      </div>
    {:else if !report}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <span class="text-muted text-xs">{m.prompt_noReport()}</span>
        <span class="text-muted text-[11px]">{m.prompt_noReportHint()}</span>
      </div>
    {:else if viewMode === 'sections' && hasSections}
      <!-- ─── Sections view detail ───────────────────────────────────────── -->
      {@const currentSection = activeSections[activeStep]}
      {#if currentSection}
        <div class="p-4 space-y-4 max-w-2xl">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="w-2 h-2 rounded-full shrink-0" style:background-color={LAYER_META[currentSection.layer]?.color ?? '#6b7280'}></span>
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
                    onclick={() => (editorOpen = true)}
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
                    onclick={() => (editorOpen = true)}
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
              {LAYER_META[currentSection.layer]?.description ?? ''}
            </p>

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
              <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                <span class="shrink-0 w-20 text-[10px] font-bold uppercase tracking-wide text-muted">{m.prompt_sectionWeight()}</span>
                <div class="flex-1 min-w-0 flex items-center gap-2">
                  <div class="flex-1 h-2 bg-bg1 rounded-full overflow-hidden border border-border/40">
                    <div
                      class="h-full rounded-full transition-all"
                      style:background-color={LAYER_META[currentSection.layer]?.color ?? '#6b7280'}
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
                        {f.missing ? '\u2717' : '\u25cf'}
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
      {/if}
    {:else}
      <!-- ─── Classic view detail ────────────────────────────────────────── -->
      <div class="p-4 space-y-4 max-w-2xl">
        {#if activeStep === 0}
          <!-- Bootstrap Files -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepBootstrap()}</h2>
            <p class="text-muted text-[11px] mb-3">
              {m.prompt_bootstrapDesc()}
              {#if report.bootstrapMaxChars}
                {m.prompt_bootstrapBudget({ perFile: fmtChars(report.bootstrapMaxChars) })}
                {#if report.bootstrapTotalMaxChars}
                  &middot; {fmtChars(report.bootstrapTotalMaxChars)} {m.prompt_bootstrapTotal()}
                {/if}.
              {/if}
            </p>
            {#if !report.injectedWorkspaceFiles?.length}
              <p class="text-muted text-[11px]">{m.prompt_noBootstrapFiles()}</p>
            {:else}
              <div class="space-y-1">
                {#each report.injectedWorkspaceFiles as f (f.name)}
                  <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                    <span class="shrink-0 text-[11px] {f.missing ? 'text-destructive' : 'text-accent'}">
                      {f.missing ? '\u2717' : '\u25cf'}
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
              <p class="text-muted text-[11px] mt-2">
                {m.prompt_filesInjectedCount({ count: report.injectedWorkspaceFiles.filter(f => !f.missing).length, total: fmtChars(report.injectedWorkspaceFiles.reduce((s, f) => s + (f.injectedChars ?? 0), 0)) })}
              </p>
            {/if}
          </div>

        {:else if activeStep === 1}
          <!-- Parameters -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepParameters()}</h2>
            <p class="text-muted text-[11px] mb-3">{m.prompt_parametersDesc()}</p>
            <div class="space-y-2">
              {#each [
                [m.agent_model(), report.model ?? '—'],
                [m.prompt_paramProvider(), report.provider ?? '—'],
                [m.prompt_paramWorkspace(), report.workspaceDir ?? '—'],
                [m.prompt_paramGenerated(), fmtDate(report.generatedAt)],
                [m.prompt_paramSource(), report.source ?? '—'],
              ] as [label, value] (label)}
                <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                  <span class="shrink-0 w-20 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
                  <span class="flex-1 min-w-0 text-[11px] text-foreground font-mono break-all">{value}</span>
                </div>
              {/each}
            </div>
          </div>

        {:else if activeStep === 2}
          <!-- Skills -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepSkills()}</h2>
            <p class="text-muted text-[11px] mb-3">
              {m.prompt_skillsDesc()}
              {#if report.skills?.promptChars}
                {m.prompt_skillsTotal({ total: fmtChars(report.skills.promptChars) })}.
              {/if}
            </p>
            {#if !report.skills?.entries?.length}
              <p class="text-muted text-[11px]">{m.prompt_noSkills()}</p>
            {:else}
              <div class="space-y-1">
                {#each report.skills.entries as s (s.name)}
                  <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                    <span class="text-accent text-[11px] shrink-0">&#x25cf;</span>
                    <span class="flex-1 min-w-0 text-[11px] text-foreground truncate">{s.name}</span>
                    <span class="shrink-0 text-[10px] text-muted">{fmtChars(s.blockChars)}</span>
                    <div class="shrink-0 w-20 h-1.5 bg-bg1 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-accent rounded-full"
                        style:width={barWidth(s.blockChars)}
                      ></div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        {:else if activeStep === 3}
          <!-- Sandbox -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepSandbox()}</h2>
            <p class="text-muted text-[11px] mb-3">{m.prompt_sandboxDesc()}</p>
            {#if !report.sandbox}
              <p class="text-muted text-[11px]">{m.prompt_noSandbox()}</p>
            {:else}
              <div class="space-y-2">
                {#each [
                  [m.prompt_sandboxEnabled(), report.sandbox.enabled ? m.prompt_yes() : m.prompt_no()],
                  [m.prompt_sandboxWorkspaceAccess(), report.sandbox.workspaceAccess ? m.prompt_yes() : m.prompt_no()],
                  [m.prompt_sandboxContainerDir(), report.sandbox.containerDir ?? '—'],
                ] as [label, value] (label)}
                  <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                    <span class="shrink-0 w-28 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
                    <span class="flex-1 min-w-0 text-[11px] text-foreground font-mono">{value}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        {:else if activeStep === 4}
          <!-- Tools -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepTools()}</h2>
            <p class="text-muted text-[11px] mb-3">
              {m.prompt_toolsDesc()}
              {#if report.tools}
                {m.prompt_toolsSizes({ list: fmtChars(report.tools.listChars), schemas: fmtChars(report.tools.schemaChars) })}.
              {/if}
            </p>
            {#if !report.tools?.entries?.length}
              <p class="text-muted text-[11px]">{m.prompt_noTools()}</p>
            {:else}
              <div class="space-y-1">
                {#each report.tools.entries as t (t.name)}
                  <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                    <span class="text-accent text-[11px] shrink-0">&#x25cf;</span>
                    <span class="flex-1 min-w-0 text-[11px] text-foreground truncate font-mono">{t.name}</span>
                    <span class="shrink-0 text-[10px] text-muted">{m.prompt_toolProps({ count: t.propertiesCount })}</span>
                    <span class="shrink-0 text-[10px] text-muted">{fmtChars(t.schemaChars)}</span>
                    <div class="shrink-0 w-20 h-1.5 bg-bg1 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-accent rounded-full"
                        style:width={barWidth(t.schemaChars)}
                      ></div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        {:else if activeStep === 5}
          <!-- Memory Context -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepMemory()}</h2>
            <p class="text-muted text-[11px] mb-3">{m.prompt_memoryDesc()}</p>
            <div class="py-3 px-3 rounded bg-bg2 border border-border/50 space-y-2">
              <p class="text-[11px] text-foreground">
                {m.prompt_memoryBody1()}
              </p>
              <p class="text-[11px] text-muted">
                {m.prompt_memoryBody2()}
              </p>
            </div>
          </div>

        {:else if activeStep === 6}
          <!-- TTS Hint -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepTts()}</h2>
            <p class="text-muted text-[11px] mb-3">{m.prompt_ttsDesc()}</p>
            <div class="py-3 px-3 rounded bg-bg2 border border-border/50 space-y-2">
              <p class="text-[11px] text-foreground">
                {m.prompt_ttsBody1()}
              </p>
              <p class="text-[11px] text-muted">
                {m.prompt_ttsBody2()}
              </p>
            </div>
          </div>

        {:else if activeStep === 7}
          <!-- Prompt Assembly -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepAssembly()}</h2>
            <p class="text-muted text-[11px] mb-3">{m.prompt_assemblyDesc()}</p>
            {#if !report.systemPrompt}
              <p class="text-muted text-[11px]">{m.prompt_noAssembly()}</p>
            {:else}
              {@const sp = report.systemPrompt}
              <div class="space-y-3">
                <div class="py-2 px-3 rounded bg-bg2 border border-border/50 flex items-center gap-3">
                  <span class="text-[10px] font-bold uppercase tracking-wide text-muted w-28 shrink-0">{m.prompt_assemblyTotal()}</span>
                  <span class="text-[11px] text-foreground font-semibold">{fmtChars(sp.chars)}</span>
                </div>

                <div class="space-y-2">
                  {#each [
                    { label: m.prompt_assemblyProjectCtx(), chars: sp.projectContextChars, color: 'bg-accent' },
                    { label: m.prompt_assemblyNonProjectCtx(), chars: sp.nonProjectContextChars, color: 'bg-muted/40' },
                  ] as seg (seg.label)}
                    <div class="space-y-1">
                      <div class="flex items-center justify-between">
                        <span class="text-[10px] text-muted">{seg.label}</span>
                        <span class="text-[10px] text-muted">{fmtChars(seg.chars)}</span>
                      </div>
                      <div class="h-2 bg-bg2 rounded-full overflow-hidden border border-border/50">
                        <div
                          class="h-full rounded-full {seg.color} transition-all"
                          style:width={barWidth(seg.chars)}
                        ></div>
                      </div>
                    </div>
                  {/each}
                </div>

                <div class="space-y-1 mt-2">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_assemblyBreakdown()}</p>
                  {#each [
                    { label: m.prompt_breakdownBootstrap(), chars: report.injectedWorkspaceFiles?.reduce((s, f) => s + (f.injectedChars ?? 0), 0) ?? 0 },
                    { label: m.prompt_stepSkills(), chars: report.skills?.promptChars ?? 0 },
                    { label: m.prompt_breakdownToolList(), chars: report.tools?.listChars ?? 0 },
                    { label: m.prompt_breakdownToolSchemas(), chars: report.tools?.schemaChars ?? 0 },
                  ] as row (row.label)}
                    {#if row.chars > 0}
                      <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                        <span class="flex-1 text-[11px] text-muted">{row.label}</span>
                        <span class="shrink-0 text-[10px] text-muted">{fmtChars(row.chars)}</span>
                        <div class="shrink-0 w-24 h-1.5 bg-bg1 rounded-full overflow-hidden">
                          <div
                            class="h-full bg-accent/60 rounded-full"
                            style:width={barWidth(row.chars)}
                          ></div>
                        </div>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          </div>

        {:else if activeStep === 8}
          <!-- Post-Turn Memory -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepPostTurn()}</h2>
            <p class="text-muted text-[11px] mb-3">{m.prompt_postTurnDesc()}</p>
            <div class="py-3 px-3 rounded bg-bg2 border border-border/50 space-y-2">
              <p class="text-[11px] text-foreground">
                {m.prompt_postTurnBody1()}
              </p>
              <p class="text-[11px] text-muted">
                {m.prompt_postTurnBody2()}
              </p>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  </div><!-- /flex flex-1 (sidebar + detail row) -->
</div>

{#if currentSectionTop && (currentSectionTop.source === 'static' || currentSectionTop.source === 'file')}
  <SectionProseEditor
    bind:open={editorOpen}
    {agentId}
    layer={currentSectionTop.layer as 'platform' | 'agent-type' | 'identity' | 'user' | 'session'}
    sectionId={currentSectionTop.id}
    sectionLabel={currentSectionTop.label}
    mode={currentSectionTop.source === 'file' ? 'fileInspector' : 'prose'}
    onSaved={() => {
      // Phase D-0f-1.5: silent refresh — don't replay the animation. Just
      // update the rendered content panel so the edit shows immediately.
      void refreshReportSilently();
    }}
  />
{/if}
