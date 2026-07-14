<script lang="ts">
  import { Button, Select } from '$lib/components/ui';

  import { Ban, Factory, GitBranch, Plus } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    FACTORY_SCOPES,
    factoryRepositoryKeys,
    recommendedRoutingCandidate,
    selectableRoutingCandidates,
    type FactoryScope,
    type FactoryIntakeView,
  } from '$lib/workforce/factory-intake';
  import { activePipelineGate, type PipelineGateIssue } from '$lib/workforce/pipeline-gate';
  import type { PipelineTrace } from '$lib/workforce/pipeline-trace';

  let {
    issue,
    trace,
    intake,
    viewerUserId,
    viewerRoleKeys = [],
    workforceAvailable,
    canEdit,
    onDecisionRecorded = () => undefined,
  }: {
    issue: PipelineGateIssue;
    trace: PipelineTrace | null;
    intake: FactoryIntakeView | null;
    viewerUserId: string | null;
    viewerRoleKeys?: readonly string[];
    workforceAvailable: boolean;
    canEdit: boolean;
    onDecisionRecorded?: () => void | Promise<void>;
  } = $props();

  const gate = $derived(activePipelineGate(issue, trace, viewerUserId, viewerRoleKeys));
  const routing = $derived(intake?.routingDecision ?? null);
  const candidates = $derived(selectableRoutingCandidates(routing?.candidates ?? []));
  const repositoryKeys = $derived(factoryRepositoryKeys(routing?.candidates ?? []));
  const visible = $derived(
    intake?.state === 'awaiting_routing_approval' &&
      gate?.stage.key === 'routing-decision' &&
      !!routing,
  );

  type Mode = 'existing_project' | 'new_project' | 'reject';
  // svelte-ignore state_referenced_locally
  let mode = $state<Mode>(candidates.length ? 'existing_project' : 'new_project');
  // svelte-ignore state_referenced_locally
  let projectId = $state(
    recommendedRoutingCandidate(candidates)?.projectId ?? candidates[0]?.projectId ?? '',
  );
  // svelte-ignore state_referenced_locally
  let projectName = $state(routing?.newProjectProposal?.name ?? '');
  // svelte-ignore state_referenced_locally
  let projectDescription = $state(routing?.newProjectProposal?.description ?? '');
  // svelte-ignore state_referenced_locally
  let repositoryKey = $state(repositoryKeys[0] ?? '');
  let groupKey = $state('');
  let scopes = $state<FactoryScope[]>([]);
  let note = $state('');
  let busy = $state(false);
  let submitError = $state('');

  function toggleScope(scope: FactoryScope) {
    scopes = scopes.includes(scope)
      ? scopes.filter((candidate) => candidate !== scope)
      : [...scopes, scope];
  }

  async function submit() {
    if (!intake || busy || !workforceAvailable || !canEdit) return;
    let decision: Record<string, unknown>;
    if (mode === 'existing_project') {
      if (!projectId) {
        submitError = m.factoryRouting_chooseProject();
        return;
      }
      decision = { kind: mode, projectId };
    } else if (mode === 'new_project') {
      if (!projectName.trim() || !repositoryKey.trim()) {
        submitError = m.factoryRouting_newRequired();
        return;
      }
      decision = {
        kind: mode,
        name: projectName.trim(),
        description: projectDescription.trim() || null,
        repositoryKey,
        groupKey: groupKey.trim() || null,
        scopes,
      };
    } else {
      decision = { kind: 'reject' };
    }

    busy = true;
    submitError = '';
    try {
      const response = await fetch(
        `/api/workforce/factory-intake/${encodeURIComponent(intake.issueId)}/routing-decision`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision, note: note.trim() || null }),
        },
      );
      if (!response.ok) {
        submitError = m.factoryRouting_submitFailed();
        return;
      }
      await onDecisionRecorded();
    } catch {
      submitError = m.factoryRouting_submitFailed();
    } finally {
      busy = false;
    }
  }
</script>

{#if visible && routing}
  <section class="routing-panel" aria-labelledby="factory-routing-title">
    <header>
      <div class="factory-mark"><Factory size={15} /></div>
      <div>
        <h2 id="factory-routing-title">{m.factoryRouting_title()}</h2>
        <p>{m.factoryRouting_description()}</p>
      </div>
    </header>

    <div class="mode-row" role="radiogroup" aria-label={m.factoryRouting_title()}>
      <Button
        type="button"
        class={mode === 'existing_project' ? 'active' : ''}
        aria-pressed={mode === 'existing_project'}
        onclick={() => (mode = 'existing_project')}
      >
        <GitBranch size={13} />
        {m.factoryRouting_existing()}
      </Button>
      <Button
        type="button"
        class={mode === 'new_project' ? 'active' : ''}
        aria-pressed={mode === 'new_project'}
        onclick={() => (mode = 'new_project')}
      >
        <Plus size={13} />
        {m.factoryRouting_new()}
      </Button>
      <Button
        type="button"
        class={mode === 'reject' ? 'active' : ''}
        aria-pressed={mode === 'reject'}
        onclick={() => (mode = 'reject')}
      >
        <Ban size={13} />
        {m.factoryRouting_reject()}
      </Button>
    </div>

    {#if mode === 'existing_project'}
      <div class="candidates">
        {#each candidates as candidate (candidate.projectId)}
          <Button
            type="button"
            class={projectId === candidate.projectId ? 'selected' : ''}
            aria-pressed={projectId === candidate.projectId}
            onclick={() => (projectId = candidate.projectId)}
          >
            <div class="candidate-head">
              <strong>{candidate.name}</strong>
              {#if candidate.confidence != null}<span>{m.factoryRouting_recommended()}</span>{/if}
              {#if candidate.confidence != null}<em
                  >{m.factoryRouting_confidence({
                    confidence: String(Math.round(candidate.confidence * 100)),
                  })}</em
                >{/if}
            </div>
            <code>{candidate.repositoryKey || candidate.key}</code>
            {#if candidate.reason}<p>{candidate.reason}</p>{/if}
          </Button>
        {/each}
      </div>
    {:else if mode === 'new_project'}
      <div class="new-project-grid">
        <label
          >{m.factoryRouting_projectName()}<input bind:value={projectName} maxlength="160" /></label
        >
        <label>
          {m.factoryRouting_repositoryKey()}
          <Select
            class="repository-select"
            bind:value={repositoryKey}
            disabled={repositoryKeys.length === 0}
          >
            {#each repositoryKeys as candidateRepository (candidateRepository)}
              <option value={candidateRepository}>{candidateRepository}</option>
            {/each}
          </Select>
        </label>
        <label class="wide"
          >{m.factoryRouting_projectDescription()}<textarea
            bind:value={projectDescription}
            maxlength="2000"></textarea></label
        >
        <label>{m.factoryRouting_groupKey()}<input bind:value={groupKey} maxlength="120" /></label>
        <fieldset class="scope-field">
          <legend>{m.factoryRouting_scopes()}</legend>
          <div class="scope-grid">
            {#each FACTORY_SCOPES as scope (scope)}
              <label class:checked={scopes.includes(scope)}>
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onchange={() => toggleScope(scope)}
                />
                {scope}
              </label>
            {/each}
          </div>
        </fieldset>
      </div>
    {/if}

    <label class="note"
      >{m.factoryRouting_note()}<textarea bind:value={note} maxlength="4000"></textarea></label
    >

    <div class="actions">
      <Button
        class="submit"
        type="button"
        onclick={submit}
        disabled={busy || !workforceAvailable || !canEdit}>{m.factoryRouting_submit()}</Button
      >
      {#if !workforceAvailable}<span>{m.workforce_gate_backendUnavailable()}</span
        >{:else if !canEdit}<span>{m.no_permission()}</span>{/if}
    </div>
    {#if submitError}<p class="error" role="alert">{submitError}</p>{/if}
  </section>
{/if}

<style>
  .routing-panel {
    border: 1px solid color-mix(in srgb, var(--color-accent) 38%, var(--color-border));
    border-radius: var(--radius-xl);
    padding: var(--space-4);
    background:
      linear-gradient(
        110deg,
        color-mix(in srgb, var(--color-accent) 7%, transparent),
        transparent 42%
      ),
      var(--color-card);
    box-shadow: var(--shadow-focus);
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .factory-mark {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
    border-radius: var(--radius-lg);
    color: var(--color-accent);
    background: var(--color-canvas);
  }
  h2 {
    color: var(--color-foreground);
    font-size: var(--font-size-caption);
    font-weight: 750;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  header p {
    margin-top: var(--space-1);
    max-width: 46rem;
    color: var(--color-muted-foreground);
    font-size: var(--font-size-caption);
    line-height: 1.45;
  }
  .mode-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-4);
  }
  .mode-row :global([data-part='button']) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-2) var(--space-3);
    color: var(--color-muted-foreground);
    background: var(--color-canvas);
    font-size: var(--font-size-caption);
    font-weight: 650;
  }
  .mode-row :global([data-part='button'].active) {
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-canvas));
  }
  .candidates {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .candidates > :global([data-part='button']) {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    text-align: left;
    background: var(--color-canvas);
  }
  .candidates > :global([data-part='button'].selected) {
    border-color: var(--color-accent);
    box-shadow: var(--shadow-overlay);
  }
  .candidate-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }
  .candidate-head strong {
    font-size: var(--font-size-caption);
  }
  .candidate-head span {
    border-radius: var(--radius-full);
    padding: var(--space-0-5) var(--space-1);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    font-size: var(--font-size-telemetry);
    text-transform: uppercase;
  }
  .candidate-head em {
    margin-left: auto;
    color: var(--color-muted-foreground);
    font-size: var(--font-size-telemetry);
    font-style: normal;
  }
  .candidates code {
    display: block;
    margin-top: var(--space-1);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-caption);
  }
  .candidates p {
    margin-top: var(--space-1);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-caption);
    line-height: 1.35;
  }
  .new-project-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .new-project-grid .wide {
    grid-column: 1 / -1;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-caption);
    font-weight: 600;
  }
  input,
  :global(.repository-select),
  textarea {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-2) var(--space-2);
    color: var(--color-foreground);
    background: var(--color-canvas);
    font-size: var(--font-size-caption);
    outline: none;
  }
  input:focus,
  :global(.repository-select):focus,
  textarea:focus {
    border-color: var(--color-accent);
  }
  :global(.repository-select):disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  textarea {
    min-height: 4.5rem;
    resize: vertical;
  }
  .scope-field {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .scope-field legend {
    color: var(--color-muted-foreground);
    font-size: var(--font-size-caption);
    font-weight: 600;
  }
  .scope-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .scope-grid label {
    position: relative;
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-2);
    color: var(--color-muted-foreground);
    background: var(--color-canvas);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: var(--font-size-telemetry);
    cursor: pointer;
  }
  .scope-grid label.checked {
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-canvas));
  }
  .scope-grid input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    opacity: 0;
    pointer-events: none;
  }
  .note {
    margin-top: var(--space-3);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .routing-panel :global(.submit) {
    border-radius: var(--radius-lg);
    padding: var(--space-2) var(--space-3);
    color: var(--color-canvas);
    background: var(--color-accent);
    font-size: var(--font-size-caption);
    font-weight: 750;
  }
  .routing-panel :global(.submit):disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .actions span {
    color: var(--color-muted-foreground);
    font-size: var(--font-size-caption);
  }
  .error {
    margin-top: var(--space-2);
    color: var(--color-destructive);
    font-size: var(--font-size-caption);
  }
  @media (max-width: 640px) {
    .new-project-grid {
      grid-template-columns: 1fr;
    }
    .new-project-grid .wide {
      grid-column: auto;
    }
  }
</style>
