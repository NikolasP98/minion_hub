<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import {
    activePipelineGate,
    buildInlinePipelineGateMutation,
    buildPipelineGateMutation,
    hasActiveInlinePipelineGate,
    type PipelineGateDecision,
    type PipelineGateIssue,
    type PipelineGateValidationError,
  } from '$lib/workforce/pipeline-gate';
  import type { PipelineTrace } from '$lib/workforce/pipeline-trace';

  let {
    issue,
    trace,
    viewerUserId,
    viewerRoleKeys = [],
    workforceAvailable,
    canEdit,
    onDecisionRecorded = () => undefined,
  }: {
    issue: PipelineGateIssue;
    trace: PipelineTrace | null;
    viewerUserId: string | null;
    viewerRoleKeys?: readonly string[];
    workforceAvailable: boolean;
    canEdit: boolean;
    onDecisionRecorded?: () => void | Promise<void>;
  } = $props();

  let summary = $state('');
  let scoreInput = $state<number | undefined>(undefined);
  let busy = $state(false);
  let submitError = $state('');

  const gate = $derived.by(() => {
    const active = activePipelineGate(issue, trace, viewerUserId, viewerRoleKeys);
    // Factory routing is a typed three-way decision, not an approve/done gate.
    return active?.stage.key === 'routing-decision' ? null : active;
  });
  const inlineGate = $derived(!gate && hasActiveInlinePipelineGate(issue));
  function stageGateMutation(decision: PipelineGateDecision) {
    if (!gate) return null;
    return buildPipelineGateMutation({
      gate,
      decision,
      summary,
      ...(gate.permitsEvalScore ? { evalScore: scoreInput } : { feedbackScore: scoreInput }),
    });
  }
  const approveResult = $derived.by(() => {
    if (gate) {
      return stageGateMutation('approve');
    }
    if (inlineGate) {
      return buildInlinePipelineGateMutation({
        decision: 'approve',
        comment: summary,
        feedbackScore: scoreInput,
      });
    }
    return null;
  });
  const changesResult = $derived.by(() => {
    if (gate) {
      return stageGateMutation('request_changes');
    }
    if (inlineGate) {
      return buildInlinePipelineGateMutation({
        decision: 'request_changes',
        comment: summary,
        feedbackScore: scoreInput,
      });
    }
    return null;
  });

  function validationMessage(error: PipelineGateValidationError): string {
    switch (error) {
      case 'summary_required':
        return m.workforce_gate_summaryRequired();
      case 'summary_too_long':
        return m.workforce_gate_summaryTooLong();
      case 'retry_unavailable':
        return m.workforce_gate_retryUnavailable();
      case 'score_contract_missing':
        return m.workforce_gate_scoreContractMissing();
      case 'score_required':
        return m.workforce_gate_scoreRequired();
      case 'score_invalid':
        return m.workforce_gate_scoreInvalid();
      case 'score_below_threshold':
        return m.workforce_gate_scoreBelowThreshold();
    }
  }

  function actionTitle(result: typeof approveResult): string | undefined {
    if (!workforceAvailable) return m.workforce_gate_backendUnavailable();
    if (!canEdit) return m.no_permission();
    if (result && !result.ok) return validationMessage(result.error);
    return undefined;
  }

  async function decide(decision: PipelineGateDecision) {
    if ((!gate && !inlineGate) || busy || !workforceAvailable || !canEdit) return;
    const result = gate
      ? stageGateMutation(decision)!
      : buildInlinePipelineGateMutation({ decision, comment: summary, feedbackScore: scoreInput });
    if (!result.ok) {
      submitError = validationMessage(result.error);
      return;
    }

    busy = true;
    submitError = '';
    try {
      const response = await fetch(`/api/workforce/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result.payload),
      });
      if (!response.ok) {
        submitError = m.workforce_gate_submitFailed({ status: String(response.status) });
        return;
      }
      summary = '';
      scoreInput = undefined;
      await onDecisionRecorded();
    } catch {
      submitError = m.workforce_gate_backendUnavailable();
    } finally {
      busy = false;
    }
  }
</script>

{#if gate || inlineGate}
  <section
    class="rounded-lg border border-accent/35 bg-accent/5 p-4"
    aria-labelledby="pipeline-gate-title"
  >
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2
          id="pipeline-gate-title"
          class="text-xs font-semibold uppercase tracking-[0.16em] text-accent dark:text-accent"
        >
          {m.workforce_gate_title()}
        </h2>
        <p class="mt-1 text-sm font-medium text-foreground">
          {gate ? gate.stage.label : m.workforce_gate_inlineTitle()}
        </p>
      </div>
      <span
        class="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-wider text-accent dark:text-accent"
      >
        {gate?.stage.kind === 'eval'
          ? m.workforce_gate_evaluation()
          : m.workforce_trace_categoryHitl()}
      </span>
    </div>

    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
      {gate ? m.workforce_gate_description() : m.workforce_gate_inlineDescription()}
    </p>

    {#if !workforceAvailable}
      <p
        class="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning dark:text-warning"
      >
        {m.workforce_gate_backendUnavailable()}
      </p>
    {:else if !canEdit}
      <p
        class="mt-3 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
      >
        {m.workforce_gate_permissionRequired()}
      </p>
    {/if}

    <label class="mt-3 block text-xs font-medium text-foreground" for="pipeline-gate-summary">
      {m.workforce_gate_summaryLabel()}
    </label>
    <textarea
      id="pipeline-gate-summary"
      class="mt-1 min-h-20 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
      maxlength="4000"
      placeholder={m.workforce_gate_summaryPlaceholder()}
      disabled={busy || !workforceAvailable || !canEdit}
      bind:value={summary}></textarea>

    {#if gate || inlineGate}
      <div class="mt-3 flex flex-wrap items-end gap-3">
        <label class="text-xs font-medium text-foreground" for="pipeline-gate-score">
          {gate?.permitsEvalScore
            ? m.workforce_gate_scoreLabel()
            : m.workforce_harness_optionalQualityScore()}
          <input
            id="pipeline-gate-score"
            class="mt-1 block w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            type="number"
            min="0"
            max={gate?.permitsEvalScore ? (gate.stage.maxScore ?? undefined) : 10}
            step="0.5"
            disabled={busy || !workforceAvailable || !canEdit}
            bind:value={scoreInput}
          />
        </label>
        {#if gate?.permitsEvalScore && gate.stage.minScore != null && gate.stage.maxScore != null}
          <p class="pb-1.5 text-xs text-muted-foreground">
            {m.workforce_gate_scoreContract({
              min: String(gate.stage.minScore),
              max: String(gate.stage.maxScore),
            })}
          </p>
        {/if}
      </div>
    {/if}

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        class="rounded-md bg-success px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-success disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || !workforceAvailable || !canEdit || !approveResult?.ok}
        title={actionTitle(approveResult)}
        onclick={() => decide('approve')}
      >
        {m.workforce_gate_approve()}
      </Button>
      <Button
        type="button"
        class="rounded-md border border-warning/50 bg-background px-3 py-1.5 text-xs font-semibold text-warning transition-colors hover:bg-warning/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-warning"
        disabled={busy || !workforceAvailable || !canEdit || !changesResult?.ok}
        title={actionTitle(changesResult)}
        onclick={() => decide('request_changes')}
      >
        {m.workforce_gate_requestChanges()}
      </Button>
      {#if gate?.retryStepKey}
        <span class="text-[length:var(--font-size-caption)] text-muted-foreground">
          {m.workforce_gate_retryTarget({ step: gate.retryStepKey })}
        </span>
      {/if}
    </div>

    {#if submitError}
      <p class="mt-2 text-xs text-destructive" role="alert">{submitError}</p>
    {/if}
  </section>
{/if}
