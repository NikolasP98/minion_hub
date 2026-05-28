<script lang="ts">
  import SectionProseEditor from '$lib/components/agents/SectionProseEditor.svelte';
  import { fetchSessionPromptReport, fetchPromptPreview } from '$lib/services/gateway.svelte';
  import * as m from '$lib/paraglide/messages';

  import ContextWindowBar from './_agent-prompt-simulator/ContextWindowBar.svelte';
  import PipelineSidebar from './_agent-prompt-simulator/PipelineSidebar.svelte';
  import SectionDetail from './_agent-prompt-simulator/SectionDetail.svelte';
  import ClassicDetail from './_agent-prompt-simulator/ClassicDetail.svelte';
  import {
    getContextWindowChars,
    type BarSegment,
    type StepStatus,
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
    platform: { label: m.prompt_layerPlatform(), color: '#6b7280', description: m.prompt_layerPlatformDesc() },
    'agent-type': { label: m.prompt_layerAgentType(), color: '#8b5cf6', description: m.prompt_layerAgentTypeDesc() },
    identity: { label: m.prompt_layerIdentity(), color: '#06b6d4', description: m.prompt_layerIdentityDesc() },
    user: { label: m.prompt_layerUser(), color: '#f59e0b', description: m.prompt_layerUserDesc() },
    session: { label: m.prompt_layerSession(), color: '#10b981', description: m.prompt_layerSessionDesc() },
  });

  let report = $state<SystemPromptReport | null>(null);
  let loading = $state(false);
  let testing = $state(false);
  let error = $state<string | null>(null);
  let activeStep = $state(0);
  let viewMode = $state<'sections' | 'classic'>('sections');

  let stepStatus = $state<Record<string, StepStatus>>({});
  let testPrompt = $state('Tell me about today\'s schedule.');
  const STEP_ANIMATION_MS = 220;

  let contentViewMode = $state<'rendered' | 'raw'>('rendered');
  let editorOpen = $state(false);

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

  const activeSections = $derived(
    report?.sections?.filter((s) => s.chars > 0) ?? [],
  );

  const currentSectionTop = $derived(activeSections[activeStep] ?? null);

  const currentSteps = $derived(
    viewMode === 'sections' && hasSections
      ? activeSections.map((s) => ({ id: s.id, label: s.label, layer: s.layer, chars: s.chars }))
      : CLASSIC_STEPS.map((s) => ({ id: s.id, label: s.label, layer: undefined as string | undefined, chars: undefined as number | undefined })),
  );

  $effect(() => {
    const sk = sessionKey;
    const _aid = agentId;
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
                return live
                  ? { ...s, content: live.content, source: s.source ?? live.source }
                  : s;
              }),
            };
          }
        } catch (e) {
          console.warn('[prompt] content backfill failed:', e);
        }
      }
    } catch (e) {
      error = (e as Error).message ?? 'Failed to load prompt report';
    } finally {
      loading = false;
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function refreshReportSilently() {
    try {
      const res = (await fetchPromptPreview(agentId)) as SystemPromptReport | null;
      if (res) {
        report = res;
      }
    } catch (e) {
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
      const res = (await fetchPromptPreview(agentId)) as SystemPromptReport | null;
      report = res;
      if (res?.sections && res.sections.length > 0) {
        viewMode = 'sections';
      }

      await sleep(0);
      const stepsToPlay = currentSteps;
      const initialStatus: Record<string, StepStatus> = {};
      for (const s of stepsToPlay) initialStatus[s.id] = 'pending';
      stepStatus = initialStatus;

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

  const totalChars = $derived(report?.systemPrompt?.chars ?? 0);

  const contextWindowChars = $derived(getContextWindowChars(report?.model));

  const segments = $derived.by<BarSegment[]>(() => {
    if (!report) return [];

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

  const currentSection = $derived(activeSections[activeStep]);
</script>

<div class="flex flex-col h-full overflow-hidden text-[12px]">

  {#if report}
    <ContextWindowBar {segments} {contextWindowChars} {totalUsedChars} />
  {/if}

  <div class="flex flex-1 min-h-0 overflow-hidden">
    <PipelineSidebar
      {viewMode}
      {hasSections}
      {activeStep}
      layerMeta={LAYER_META}
      {activeSections}
      {currentSteps}
      classicSteps={CLASSIC_STEPS}
      {stepStatus}
      bind:testPrompt
      {testing}
      {loading}
      onToggleViewMode={() => {
        viewMode = viewMode === 'sections' ? 'classic' : 'sections';
        activeStep = 0;
      }}
      onSelectStep={(idx) => (activeStep = idx)}
      onRunTest={runTest}
      onRefresh={() => loadReport(sessionKey)}
    />

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
        {#if currentSection}
          <SectionDetail
            {currentSection}
            {report}
            layerMeta={LAYER_META}
            {totalChars}
            bind:contentViewMode
            onOpenEditor={() => (editorOpen = true)}
          />
        {/if}
      {:else}
        <ClassicDetail {activeStep} {report} {totalChars} />
      {/if}
    </div>
  </div>
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
      void refreshReportSilently();
    }}
  />
{/if}
