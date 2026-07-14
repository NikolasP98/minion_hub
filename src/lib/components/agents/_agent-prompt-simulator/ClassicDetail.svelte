<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { fmtChars, fmtDate, type SystemPromptReport } from './types';

  let {
    activeStep,
    report,
    totalChars,
  }: {
    activeStep: number;
    report: SystemPromptReport;
    totalChars: number;
  } = $props();

  function barWidth(chars: number): string {
    if (!totalChars || chars <= 0) return '0%';
    return `${Math.min((chars / totalChars) * 100, 100).toFixed(1)}%`;
  }
</script>

<div class="p-4 space-y-4 max-w-2xl">
  {#if activeStep === 0}
    <!-- Bootstrap Files -->
    <div>
      <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepBootstrap()}</h2>
      <p class="text-muted text-[length:var(--font-size-caption)] mb-3">
        {m.prompt_bootstrapDesc()}
        {#if report.bootstrapMaxChars}
          {m.prompt_bootstrapBudget({ perFile: fmtChars(report.bootstrapMaxChars) })}
          {#if report.bootstrapTotalMaxChars}
            &middot; {fmtChars(report.bootstrapTotalMaxChars)} {m.prompt_bootstrapTotal()}
          {/if}.
        {/if}
      </p>
      {#if !report.injectedWorkspaceFiles?.length}
        <p class="text-muted text-[length:var(--font-size-caption)]">{m.prompt_noBootstrapFiles()}</p>
      {:else}
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
                  <span class="shrink-0 text-[length:var(--font-size-telemetry)] font-semibold px-1 py-0.5 rounded bg-warning/15 text-warning">{m.prompt_fileTruncated()}</span>
                {:else}
                  <span class="shrink-0 text-[length:var(--font-size-telemetry)] font-semibold px-1 py-0.5 rounded bg-success/10 text-success">{m.prompt_fileOk()}</span>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
        <p class="text-muted text-[length:var(--font-size-caption)] mt-2">
          {m.prompt_filesInjectedCount({ count: report.injectedWorkspaceFiles.filter(f => !f.missing).length, total: fmtChars(report.injectedWorkspaceFiles.reduce((s, f) => s + (f.injectedChars ?? 0), 0)) })}
        </p>
      {/if}
    </div>

  {:else if activeStep === 1}
    <!-- Parameters -->
    <div>
      <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepParameters()}</h2>
      <p class="text-muted text-[length:var(--font-size-caption)] mb-3">{m.prompt_parametersDesc()}</p>
      <div class="space-y-2">
        {#each [
          [m.agent_model(), report.model ?? '—'],
          [m.prompt_paramProvider(), report.provider ?? '—'],
          [m.prompt_paramWorkspace(), report.workspaceDir ?? '—'],
          [m.prompt_paramGenerated(), fmtDate(report.generatedAt)],
          [m.prompt_paramSource(), report.source ?? '—'],
        ] as [label, value] (label)}
          <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
            <span class="shrink-0 w-20 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">{label}</span>
            <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground font-mono break-all">{value}</span>
          </div>
        {/each}
      </div>
    </div>

  {:else if activeStep === 2}
    <!-- Skills -->
    <div>
      <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepSkills()}</h2>
      <p class="text-muted text-[length:var(--font-size-caption)] mb-3">
        {m.prompt_skillsDesc()}
        {#if report.skills?.promptChars}
          {m.prompt_skillsTotal({ total: fmtChars(report.skills.promptChars) })}.
        {/if}
      </p>
      {#if !report.skills?.entries?.length}
        <p class="text-muted text-[length:var(--font-size-caption)]">{m.prompt_noSkills()}</p>
      {:else}
        <div class="space-y-1">
          {#each report.skills.entries as s (s.name)}
            <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="text-accent text-[length:var(--font-size-caption)] shrink-0">&#x25cf;</span>
              <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground truncate">{s.name}</span>
              <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-muted">{fmtChars(s.blockChars)}</span>
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
      <p class="text-muted text-[length:var(--font-size-caption)] mb-3">{m.prompt_sandboxDesc()}</p>
      {#if !report.sandbox}
        <p class="text-muted text-[length:var(--font-size-caption)]">{m.prompt_noSandbox()}</p>
      {:else}
        <div class="space-y-2">
          {#each [
            [m.prompt_sandboxEnabled(), report.sandbox.enabled ? m.prompt_yes() : m.prompt_no()],
            [m.prompt_sandboxWorkspaceAccess(), report.sandbox.workspaceAccess ? m.prompt_yes() : m.prompt_no()],
            [m.prompt_sandboxContainerDir(), report.sandbox.containerDir ?? '—'],
          ] as [label, value] (label)}
            <div class="flex items-start gap-3 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="shrink-0 w-28 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted">{label}</span>
              <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground font-mono">{value}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

  {:else if activeStep === 4}
    <!-- Tools -->
    <div>
      <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepTools()}</h2>
      <p class="text-muted text-[length:var(--font-size-caption)] mb-3">
        {m.prompt_toolsDesc()}
        {#if report.tools}
          {m.prompt_toolsSizes({ list: fmtChars(report.tools.listChars), schemas: fmtChars(report.tools.schemaChars) })}.
        {/if}
      </p>
      {#if !report.tools?.entries?.length}
        <p class="text-muted text-[length:var(--font-size-caption)]">{m.prompt_noTools()}</p>
      {:else}
        <div class="space-y-1">
          {#each report.tools.entries as t (t.name)}
            <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
              <span class="text-accent text-[length:var(--font-size-caption)] shrink-0">&#x25cf;</span>
              <span class="flex-1 min-w-0 text-[length:var(--font-size-caption)] text-foreground truncate font-mono">{t.name}</span>
              <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-muted">{m.prompt_toolProps({ count: t.propertiesCount })}</span>
              <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-muted">{fmtChars(t.schemaChars)}</span>
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
      <p class="text-muted text-[length:var(--font-size-caption)] mb-3">{m.prompt_memoryDesc()}</p>
      <div class="py-3 px-3 rounded bg-bg2 border border-border/50 space-y-2">
        <p class="text-[length:var(--font-size-caption)] text-foreground">
          {m.prompt_memoryBody1()}
        </p>
        <p class="text-[length:var(--font-size-caption)] text-muted">
          {m.prompt_memoryBody2()}
        </p>
      </div>
    </div>

  {:else if activeStep === 6}
    <!-- TTS Hint -->
    <div>
      <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepTts()}</h2>
      <p class="text-muted text-[length:var(--font-size-caption)] mb-3">{m.prompt_ttsDesc()}</p>
      <div class="py-3 px-3 rounded bg-bg2 border border-border/50 space-y-2">
        <p class="text-[length:var(--font-size-caption)] text-foreground">
          {m.prompt_ttsBody1()}
        </p>
        <p class="text-[length:var(--font-size-caption)] text-muted">
          {m.prompt_ttsBody2()}
        </p>
      </div>
    </div>

  {:else if activeStep === 7}
    <!-- Prompt Assembly -->
    <div>
      <h2 class="text-sm font-semibold text-foreground mb-1">{m.prompt_stepAssembly()}</h2>
      <p class="text-muted text-[length:var(--font-size-caption)] mb-3">{m.prompt_assemblyDesc()}</p>
      {#if !report.systemPrompt}
        <p class="text-muted text-[length:var(--font-size-caption)]">{m.prompt_noAssembly()}</p>
      {:else}
        {@const sp = report.systemPrompt}
        <div class="space-y-3">
          <div class="py-2 px-3 rounded bg-bg2 border border-border/50 flex items-center gap-3">
            <span class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted w-28 shrink-0">{m.prompt_assemblyTotal()}</span>
            <span class="text-[length:var(--font-size-caption)] text-foreground font-semibold">{fmtChars(sp.chars)}</span>
          </div>

          <div class="space-y-2">
            {#each [
              { label: m.prompt_assemblyProjectCtx(), chars: sp.projectContextChars, color: 'bg-accent' },
              { label: m.prompt_assemblyNonProjectCtx(), chars: sp.nonProjectContextChars, color: 'bg-muted/40' },
            ] as seg (seg.label)}
              <div class="space-y-1">
                <div class="flex items-center justify-between">
                  <span class="text-[length:var(--font-size-telemetry)] text-muted">{seg.label}</span>
                  <span class="text-[length:var(--font-size-telemetry)] text-muted">{fmtChars(seg.chars)}</span>
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
            <p class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted mb-1">{m.prompt_assemblyBreakdown()}</p>
            {#each [
              { label: m.prompt_breakdownBootstrap(), chars: report.injectedWorkspaceFiles?.reduce((s, f) => s + (f.injectedChars ?? 0), 0) ?? 0 },
              { label: m.prompt_stepSkills(), chars: report.skills?.promptChars ?? 0 },
              { label: m.prompt_breakdownToolList(), chars: report.tools?.listChars ?? 0 },
              { label: m.prompt_breakdownToolSchemas(), chars: report.tools?.schemaChars ?? 0 },
            ] as row (row.label)}
              {#if row.chars > 0}
                <div class="flex items-center gap-2 py-1.5 px-2 rounded bg-bg2 border border-border/50">
                  <span class="flex-1 text-[length:var(--font-size-caption)] text-muted">{row.label}</span>
                  <span class="shrink-0 text-[length:var(--font-size-telemetry)] text-muted">{fmtChars(row.chars)}</span>
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
      <p class="text-muted text-[length:var(--font-size-caption)] mb-3">{m.prompt_postTurnDesc()}</p>
      <div class="py-3 px-3 rounded bg-bg2 border border-border/50 space-y-2">
        <p class="text-[length:var(--font-size-caption)] text-foreground">
          {m.prompt_postTurnBody1()}
        </p>
        <p class="text-[length:var(--font-size-caption)] text-muted">
          {m.prompt_postTurnBody2()}
        </p>
      </div>
    </div>
  {/if}
</div>
