<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Button } from '$lib/components/ui';
  import { Select, Textarea } from '@minion-stack/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { pulse } from '$lib/state/features/pulse.svelte';
  import { tryUseActions } from '$lib/services/actions/context';
  import {
    requireOk,
    runCheckedMutation,
    runTrackedCommand,
  } from '$lib/services/actions/mutations';
  import type { PulseFeedbackRow } from '$server/db/pg-schema/pulse-feedback';
  import * as m from '$lib/paraglide/messages';
  let { proposalId, revision }: { proposalId: string; revision: number } = $props();
  const actions = tryUseActions();
  let reason = $state('useful');
  let comment = $state('');
  let busy = $state(false);
  let saving = $state(false);
  let loaded = $state(false);
  let notice = $state<string | null>(null);
  let recovery = $state<'unknown' | 'committed-refreshing' | 'conflict' | null>(null);
  let latest = $state<PulseFeedbackRow | null>(null);
  let actionId: string | null = null;
  let submittedDraft = '';
  let runtimeActionId: number | undefined;
  let generation = 0;
  let readGeneration = 0;
  let disposed = false;
  const scope = $derived(pulse.scopeKey(actions?.scopeVersion));
  const identity = $derived(JSON.stringify([scope, proposalId, revision]));
  const canEdit = $derived.by(() => {
    void identity;
    return canAct('pulse', 'edit');
  });
  const options = $derived([
    { value: 'useful', label: m.pulse_feedbackUseful() },
    { value: 'irrelevant', label: m.pulse_feedbackIrrelevant() },
    { value: 'duplicate', label: m.pulse_feedbackDuplicate() },
    { value: 'fact_error', label: m.pulse_feedbackFactError() },
    { value: 'already_handled', label: m.pulse_feedbackHandled() },
    { value: 'too_late', label: m.pulse_feedbackLate() },
  ]);
  $effect(() => {
    const owner = [scope, proposalId, revision];
    untrack(() => {
      generation++;
      readGeneration++;
      reason = 'useful';
      comment = '';
      latest = null;
      loaded = false;
      busy = false;
      saving = false;
      notice = null;
      recovery = null;
      actionId = null;
      runtimeActionId = undefined;
      submittedDraft = '';
      void read(owner[0]);
    });
  });
  onDestroy(() => {
    disposed = true;
    generation++;
    readGeneration++;
  });
  function owned(token: number, key: string) {
    return !disposed && token === generation && key === identity;
  }
  async function read(expectedScope: unknown = scope) {
    if (expectedScope !== scope) return false;
    const token = generation,
      key = identity,
      read = ++readGeneration;
    const current = () => owned(token, key) && read === readGeneration;
    try {
      const response = await requireOk(
        await fetch(`/api/pulse/proposals/${encodeURIComponent(proposalId)}/feedback`),
        m.pulse_readFailed(),
      );
      const data: unknown = await response.json();
      if (!current()) return false;
      const rows = (data as { feedback?: unknown })?.feedback;
      if (
        !Array.isArray(rows) ||
        rows.length > 100 ||
        rows.some(
          (r) =>
            !r ||
            typeof r.id !== 'string' ||
            typeof r.clientActionId !== 'string' ||
            typeof r.reason !== 'string' ||
            r.proposalId !== proposalId ||
            r.contentRevision !== revision,
        )
      )
        throw new Error('feedback_response');
      const feedback = rows as PulseFeedbackRow[];
      const corrected = new Set(feedback.map((r) => r.supersedesFeedbackId));
      latest = feedback.find((r) => !corrected.has(r.id)) ?? null;
      loaded = true;
      if (recovery === 'unknown' && !feedback.some((r) => r.clientActionId === actionId)) {
        notice = m.asyncAction_unknown();
        return true;
      }
      if (recovery && feedback.some((r) => r.clientActionId === actionId)) {
        reason = latest?.reason ?? reason;
        comment = latest?.comment ?? '';
        if (runtimeActionId !== undefined) actions?.reconcile(runtimeActionId, 'succeeded');
        runtimeActionId = undefined;
        actionId = null;
      }
      recovery = null;
      notice = null;
      return true;
    } catch {
      if (current()) notice = m.pulse_readFailed();
      return false;
    }
  }
  async function reload() {
    if (busy) return;
    const token = generation,
      key = identity;
    busy = true;
    try {
      await read();
    } finally {
      if (owned(token, key)) busy = false;
    }
  }
  async function save() {
    if (busy || !loaded || recovery || !canEdit) return;
    const token = generation,
      key = identity;
    const current = () => owned(token, key);
    const draft = JSON.stringify([proposalId, revision, reason, comment, latest?.id ?? null]);
    if (!actionId || submittedDraft !== draft) {
      actionId = crypto.randomUUID();
      submittedDraft = draft;
    }
    const clientActionId = actionId;
    const payload = {
      clientActionId,
      expectedContentRevision: revision,
      reason,
      comment,
      ...(latest ? { supersedesFeedbackId: latest.id } : {}),
    };
    busy = true;
    notice = null;
    saving = true;
    try {
      const outcome = await runTrackedCommand(actions, 'pulse.feedback.save', (context) => {
        runtimeActionId = context?.actionId;
        return runCheckedMutation({
          context,
          attemptId: 'pulse.feedback.write',
          mutate: async (signal) => {
            const response = await requireOk(
              await fetch(`/api/pulse/proposals/${encodeURIComponent(proposalId)}/feedback`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
                signal,
              }),
              m.pulse_feedbackFailed(),
            );
            const data = (await response.json()) as { feedback: PulseFeedbackRow };
            return data.feedback;
          },
          onCommitted: (value) => {
            if (current()) latest = value;
          },
          refresh: async () => {
            if (!current()) return;
            if (!(await read())) throw new Error('feedback_refresh');
          },
          refreshAttemptId: 'pulse.feedback.refresh',
        });
      });
      if (!current()) return;
      if (outcome.status === 'succeeded') {
        notice = m.pulse_feedbackSaved();
        actionId = null;
      } else if (
        outcome.status === 'unknown' ||
        outcome.status === 'committed-refreshing' ||
        outcome.status === 'conflict'
      ) {
        recovery = outcome.status;
        notice =
          outcome.status === 'committed-refreshing'
            ? m.asyncAction_refreshing()
            : outcome.status === 'unknown'
              ? m.asyncAction_unknown()
              : m.pulse_refreshRequired();
      } else notice = m.pulse_feedbackFailed();
    } finally {
      if (current()) {
        busy = false;
        saving = false;
      }
    }
  }
</script>

<section class="feedback" aria-label={m.pulse_feedbackTitle()} data-pulse-feedback={proposalId}>
  <h4 class="t-label">{m.pulse_feedbackTitle()}</h4>
  <p class="t-caption">{m.pulse_feedbackExplanation()}</p>
  {#if canEdit}
    <Select
      id={`feedback-reason-${proposalId}`}
      label={m.pulse_feedbackReason()}
      {options}
      bind:value={reason}
      disabled={busy || !loaded || recovery !== null}
    />
    <Textarea
      id={`feedback-comment-${proposalId}`}
      label={m.pulse_feedbackComment()}
      helper={m.pulse_feedbackLimit({ count: Array.from(comment).length })}
      rows={3}
      bind:value={comment}
      disabled={busy || !loaded || recovery !== null}
    />
    <div class="feedback-actions">
      <Button
        variant="secondary"
        size="touch"
        loading={saving}
        disabled={busy || !loaded || recovery !== null || Array.from(comment).length > 500}
        onclick={save}>{latest ? m.pulse_feedbackCorrect() : m.pulse_feedbackSave()}</Button
      >
      {#if !loaded || recovery}<Button
          variant="secondary"
          size="touch"
          loading={busy}
          onclick={reload}>{m.asyncAction_reload()}</Button
        >{/if}
    </div>
  {/if}
  {#if notice}<p class="t-caption" role="status">{notice}</p>{/if}
  {#if latest}<p class="t-caption">
      {m.pulse_feedbackRecorded({
        reason: options.find((o) => o.value === latest?.reason)?.label ?? latest.reason,
      })}
    </p>{/if}
</section>

<style>
  .feedback {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    margin-block-start: var(--space-3);
  }
  .feedback-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
