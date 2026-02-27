<script lang="ts">
  import { fetchSessionPromptReport } from '$lib/services/gateway.svelte';

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
  }

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
  }

  // ─── State ────────────────────────────────────────────────────────────────

  let report = $state<SystemPromptReport | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let activeStep = $state(0);

  // ─── Pipeline step definitions ────────────────────────────────────────────

  const STEPS = [
    { id: 'bootstrap', label: 'Bootstrap Files' },
    { id: 'parameters', label: 'Parameters' },
    { id: 'skills', label: 'Skills' },
    { id: 'sandbox', label: 'Sandbox' },
    { id: 'tools', label: 'Tools' },
    { id: 'memory', label: 'Memory Context' },
    { id: 'tts', label: 'TTS Hint' },
    { id: 'assembly', label: 'Prompt Assembly' },
    { id: 'post-turn', label: 'Post-Turn Memory' },
  ];

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

  // ─── Helpers ──────────────────────────────────────────────────────────────

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
    stepIdx: number; // -1 = always-revealed (core), 0/2/4 = contributing step
    label: string;
    chars: number;
    color: string;
  }

  // Colors for contributing steps — used in both the bar and sidebar dots
  const STEP_COLORS: Record<number, string> = {
    0: '#06b6d4', // Bootstrap — cyan
    2: '#8b5cf6', // Skills    — violet
    4: '#f59e0b', // Tools     — amber
  };

  function getContextWindowChars(model: string | undefined): number {
    if (!model) return 800_000;
    const m = model.toLowerCase();
    if (m.includes('claude')) return 800_000; // 200k tokens × 4
    if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 512_000; // 128k × 4
    if (m.includes('gpt-4')) return 32_768; // 8k × 4
    if (m.includes('gpt-3.5-turbo-16k')) return 65_536;
    if (m.includes('gpt-3.5')) return 16_384;
    if (m.includes('gemini-1.5')) return 4_000_000; // 1M × 4
    if (m.includes('gemini')) return 400_000;
    return 800_000;
  }

  const contextWindowChars = $derived(getContextWindowChars(report?.model));

  const segments = $derived.by<BarSegment[]>(() => {
    if (!report) return [];
    const bootstrapChars =
      report.injectedWorkspaceFiles?.reduce((s, f) => s + (f.injectedChars ?? 0), 0) ?? 0;
    const skillsChars = report.skills?.promptChars ?? 0;
    const toolsChars = (report.tools?.listChars ?? 0) + (report.tools?.schemaChars ?? 0);
    const systemTotal = report.systemPrompt?.chars ?? 0;
    const coreChars = Math.max(0, systemTotal - bootstrapChars - skillsChars - toolsChars);
    const segs: BarSegment[] = [];
    if (coreChars > 0) segs.push({ stepIdx: -1, label: 'Core', chars: coreChars, color: '#6b7280' });
    if (bootstrapChars > 0) segs.push({ stepIdx: 0, label: 'Bootstrap', chars: bootstrapChars, color: STEP_COLORS[0] });
    if (skillsChars > 0) segs.push({ stepIdx: 2, label: 'Skills', chars: skillsChars, color: STEP_COLORS[2] });
    if (toolsChars > 0) segs.push({ stepIdx: 4, label: 'Tools', chars: toolsChars, color: STEP_COLORS[4] });
    return segs;
  });

  // Chars from all segments at or before the active step (for cursor line)
  const revealedChars = $derived(
    segments.filter((s) => s.stepIdx <= activeStep).reduce((acc, s) => acc + s.chars, 0),
  );

  const revealedPct = $derived(
    contextWindowChars > 0 ? (revealedChars / contextWindowChars) * 100 : 0,
  );

  const totalUsedChars = $derived(segments.reduce((s, seg) => s + seg.chars, 0));

  function fmtContextPct(chars: number): string {
    if (!contextWindowChars) return '';
    return `${((chars / contextWindowChars) * 100).toFixed(1)}%`;
  }
</script>

<div class="flex flex-col h-full overflow-hidden text-[12px]">

  <!-- ─── Context Window Bar (persistent across all steps) ─────────────── -->
  {#if report}
    <div class="shrink-0 border-b border-border bg-bg2 px-3 pt-2 pb-2 space-y-1.5">
      <!-- Stacked bar -->
      <div class="relative h-2.5 bg-bg1 rounded-sm overflow-hidden border border-border/40 flex">
        {#each segments as seg (seg.stepIdx)}
          {@const isFuture = seg.stepIdx > activeStep}
          {@const isCurrent = seg.stepIdx === activeStep}
          <div
            class="h-full shrink-0 transition-all duration-300"
            style:background-color={seg.color}
            style:width="{((seg.chars / contextWindowChars) * 100).toFixed(2)}%"
            style:opacity={isFuture ? '0.18' : '1'}
            style:filter={isCurrent ? 'brightness(1.25)' : 'none'}
          ></div>
        {/each}
        <!-- Cursor line at revealed/unrevealed boundary -->
        {#if revealedPct > 0.1 && revealedPct < 99.9}
          <div
            class="absolute top-0 bottom-0 w-px bg-white/50 pointer-events-none"
            style:left="{revealedPct.toFixed(2)}%"
          ></div>
        {/if}
      </div>

      <!-- Legend row -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0 flex-wrap">
          {#each segments as seg (seg.stepIdx)}
            {@const isFuture = seg.stepIdx > activeStep}
            <span
              class="flex items-center gap-1 transition-opacity duration-300"
              style:opacity={isFuture ? '0.35' : '1'}
            >
              <span class="w-2 h-2 rounded-sm shrink-0" style:background-color={seg.color}></span>
              <span class="text-[10px] text-muted">{seg.label}</span>
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
    <div class="px-3 py-2 border-b border-border">
      <span class="text-[10px] font-bold uppercase tracking-widest text-muted">Pipeline</span>
    </div>
    <div class="flex-1 py-1">
      {#each STEPS as step, i (step.id)}
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
          {#if STEP_COLORS[i] && report}
            <span
              class="shrink-0 w-1.5 h-1.5 rounded-full ml-auto"
              style:background-color={STEP_COLORS[i]}
              style:opacity={i > activeStep ? '0.3' : '1'}
            ></span>
          {/if}
        </button>
      {/each}
    </div>
    <!-- Reload button -->
    <div class="shrink-0 px-3 py-2 border-t border-border">
      <button
        type="button"
        class="w-full text-[10px] font-semibold px-2 py-1 rounded border border-border text-muted hover:text-foreground hover:border-accent/50 transition-colors"
        onclick={() => loadReport(sessionKey)}
        disabled={loading}
      >
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    </div>
  </div>

  <!-- Detail panel -->
  <div class="flex-1 min-w-0 overflow-y-auto bg-bg">
    {#if loading}
      <div class="flex items-center justify-center h-full gap-2 text-muted text-xs">
        <div class="w-4 h-4 border-2 border-border border-t-accent rounded-full animate-spin"></div>
        Loading prompt report…
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center h-full gap-3">
        <span class="text-destructive text-xs">Could not load prompt report</span>
        <span class="text-muted text-[11px]">{error}</span>
        <button
          type="button"
          class="text-[11px] font-semibold px-3 py-1.5 rounded border border-border text-muted hover:text-foreground transition-colors"
          onclick={() => loadReport(sessionKey)}
        >
          Retry
        </button>
      </div>
    {:else if !report}
      <div class="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
        <span class="text-2xl opacity-20">🧠</span>
        <span class="text-muted text-xs">No prompt report available for this agent yet.</span>
        <span class="text-muted text-[11px]">Send a message to generate the system prompt.</span>
      </div>
    {:else}
      <!-- Step content -->
      <div class="p-4 space-y-4 max-w-2xl">
        {#if activeStep === 0}
          <!-- Bootstrap Files -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">Bootstrap Files</h2>
            <p class="text-muted text-[11px] mb-3">
              Workspace files injected at prompt start.
              {#if report.bootstrapMaxChars}
                Budget: {fmtChars(report.bootstrapMaxChars)} per file
                {#if report.bootstrapTotalMaxChars}
                  · {fmtChars(report.bootstrapTotalMaxChars)} total
                {/if}.
              {/if}
            </p>
            {#if !report.injectedWorkspaceFiles?.length}
              <p class="text-muted text-[11px]">No bootstrap files reported.</p>
            {:else}
              <div class="space-y-1">
                {#each report.injectedWorkspaceFiles as f (f.name)}
                  <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                    <span class="shrink-0 text-[11px] {f.missing ? 'text-destructive' : 'text-accent'}">
                      {f.missing ? '✗' : '●'}
                    </span>
                    <span class="flex-1 min-w-0 text-[11px] font-mono text-foreground truncate">{f.name}</span>
                    {#if f.missing}
                      <span class="shrink-0 text-[10px] text-destructive font-semibold">missing</span>
                    {:else}
                      <span class="shrink-0 text-[10px] text-muted">{fmtChars(f.injectedChars)}</span>
                      {#if f.truncated}
                        <span class="shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">truncated</span>
                      {:else}
                        <span class="shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded bg-green-500/10 text-green-400">ok</span>
                      {/if}
                    {/if}
                  </div>
                {/each}
              </div>
              <p class="text-muted text-[11px] mt-2">
                {report.injectedWorkspaceFiles.filter(f => !f.missing).length} injected
                · {fmtChars(report.injectedWorkspaceFiles.reduce((s, f) => s + (f.injectedChars ?? 0), 0))} total
              </p>
            {/if}
          </div>

        {:else if activeStep === 1}
          <!-- Parameters -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">Parameters</h2>
            <p class="text-muted text-[11px] mb-3">Model and environment configuration for this agent session.</p>
            <div class="space-y-2">
              {#each [
                ['Model', report.model ?? '—'],
                ['Provider', report.provider ?? '—'],
                ['Workspace', report.workspaceDir ?? '—'],
                ['Generated', fmtDate(report.generatedAt)],
                ['Source', report.source ?? '—'],
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
            <h2 class="text-sm font-semibold text-foreground mb-1">Skills</h2>
            <p class="text-muted text-[11px] mb-3">
              Skill blocks injected into the system prompt.
              {#if report.skills?.promptChars}
                Total: {fmtChars(report.skills.promptChars)}.
              {/if}
            </p>
            {#if !report.skills?.entries?.length}
              <p class="text-muted text-[11px]">No skills reported.</p>
            {:else}
              <div class="space-y-1">
                {#each report.skills.entries as s (s.name)}
                  <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                    <span class="text-accent text-[11px] shrink-0">●</span>
                    <span class="flex-1 min-w-0 text-[11px] text-foreground truncate">{s.name}</span>
                    <span class="shrink-0 text-[10px] text-muted">{fmtChars(s.blockChars)}</span>
                    <!-- size bar -->
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
            <h2 class="text-sm font-semibold text-foreground mb-1">Sandbox</h2>
            <p class="text-muted text-[11px] mb-3">Sandbox isolation configuration for this agent.</p>
            {#if !report.sandbox}
              <p class="text-muted text-[11px]">No sandbox configuration reported.</p>
            {:else}
              <div class="space-y-2">
                {#each [
                  ['Enabled', report.sandbox.enabled ? 'Yes' : 'No'],
                  ['Workspace access', report.sandbox.workspaceAccess ? 'Yes' : 'No'],
                  ['Container dir', report.sandbox.containerDir ?? '—'],
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
            <h2 class="text-sm font-semibold text-foreground mb-1">Tools</h2>
            <p class="text-muted text-[11px] mb-3">
              Tools available to this agent.
              {#if report.tools}
                List: {fmtChars(report.tools.listChars)} · Schemas: {fmtChars(report.tools.schemaChars)}.
              {/if}
            </p>
            {#if !report.tools?.entries?.length}
              <p class="text-muted text-[11px]">No tool entries reported.</p>
            {:else}
              <div class="space-y-1">
                {#each report.tools.entries as t (t.name)}
                  <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                    <span class="text-accent text-[11px] shrink-0">●</span>
                    <span class="flex-1 min-w-0 text-[11px] text-foreground truncate font-mono">{t.name}</span>
                    <span class="shrink-0 text-[10px] text-muted">{t.propertiesCount} props</span>
                    <span class="shrink-0 text-[10px] text-muted">{fmtChars(t.schemaChars)}</span>
                    <!-- size bar -->
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
            <h2 class="text-sm font-semibold text-foreground mb-1">Memory Context</h2>
            <p class="text-muted text-[11px] mb-3">Dynamic per-turn knowledge graph retrieval.</p>
            <div class="py-3 px-3 rounded bg-bg2 border border-border/50 space-y-2">
              <p class="text-[11px] text-foreground">
                Before each turn, the gateway queries the knowledge graph for entity mentions relevant to the user's message.
              </p>
              <p class="text-[11px] text-muted">
                Retrieved facts are injected as context — max ~500 tokens per turn. This is dynamic and not captured in the static report above.
              </p>
            </div>
          </div>

        {:else if activeStep === 6}
          <!-- TTS Hint -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">TTS Hint</h2>
            <p class="text-muted text-[11px] mb-3">Text-to-speech output formatting instructions.</p>
            <div class="py-3 px-3 rounded bg-bg2 border border-border/50 space-y-2">
              <p class="text-[11px] text-foreground">
                If <code class="font-mono bg-bg1 px-1 rounded">tts</code> is configured for this agent, the gateway injects formatting instructions asking the model to produce speech-friendly output (avoid markdown, keep responses concise).
              </p>
              <p class="text-[11px] text-muted">
                This hint is config-dependent and not visible in the static report.
              </p>
            </div>
          </div>

        {:else if activeStep === 7}
          <!-- Prompt Assembly -->
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">Prompt Assembly</h2>
            <p class="text-muted text-[11px] mb-3">Final assembled system prompt composition.</p>
            {#if !report.systemPrompt}
              <p class="text-muted text-[11px]">No assembly data reported.</p>
            {:else}
              {@const sp = report.systemPrompt}
              <div class="space-y-3">
                <!-- Total -->
                <div class="py-2 px-3 rounded bg-bg2 border border-border/50 flex items-center gap-3">
                  <span class="text-[10px] font-bold uppercase tracking-wide text-muted w-28 shrink-0">Total</span>
                  <span class="text-[11px] text-foreground font-semibold">{fmtChars(sp.chars)}</span>
                </div>

                <!-- Project vs non-project bar chart -->
                <div class="space-y-2">
                  {#each [
                    { label: 'Project context', chars: sp.projectContextChars, color: 'bg-accent' },
                    { label: 'Non-project context', chars: sp.nonProjectContextChars, color: 'bg-muted/40' },
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

                <!-- Breakdown table -->
                <div class="space-y-1 mt-2">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Breakdown</p>
                  {#each [
                    { label: 'Bootstrap files', chars: report.injectedWorkspaceFiles?.reduce((s, f) => s + (f.injectedChars ?? 0), 0) ?? 0 },
                    { label: 'Skills', chars: report.skills?.promptChars ?? 0 },
                    { label: 'Tool list', chars: report.tools?.listChars ?? 0 },
                    { label: 'Tool schemas', chars: report.tools?.schemaChars ?? 0 },
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
            <h2 class="text-sm font-semibold text-foreground mb-1">Post-Turn Memory</h2>
            <p class="text-muted text-[11px] mb-3">Knowledge graph extraction after each response.</p>
            <div class="py-3 px-3 rounded bg-bg2 border border-border/50 space-y-2">
              <p class="text-[11px] text-foreground">
                After each assistant response, the gateway runs an extraction pass to identify facts, entities, and relationships mentioned in the turn.
              </p>
              <p class="text-[11px] text-muted">
                Extracted facts are stored to the knowledge graph and become available as memory context in future turns. This process happens asynchronously and is not captured in the static report.
              </p>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  </div><!-- /flex flex-1 (sidebar + detail row) -->
</div>
