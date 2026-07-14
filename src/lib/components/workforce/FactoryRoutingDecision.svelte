<script lang="ts">
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
	import {
		activePipelineGate,
		type PipelineGateIssue,
	} from '$lib/workforce/pipeline-gate';
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
	let projectId = $state(recommendedRoutingCandidate(candidates)?.projectId ?? candidates[0]?.projectId ?? '');
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
			<button type="button" class:active={mode === 'existing_project'} aria-pressed={mode === 'existing_project'} onclick={() => (mode = 'existing_project')}>
				<GitBranch size={13} /> {m.factoryRouting_existing()}
			</button>
			<button type="button" class:active={mode === 'new_project'} aria-pressed={mode === 'new_project'} onclick={() => (mode = 'new_project')}>
				<Plus size={13} /> {m.factoryRouting_new()}
			</button>
			<button type="button" class:active={mode === 'reject'} aria-pressed={mode === 'reject'} onclick={() => (mode = 'reject')}>
				<Ban size={13} /> {m.factoryRouting_reject()}
			</button>
		</div>

		{#if mode === 'existing_project'}
			<div class="candidates">
				{#each candidates as candidate (candidate.projectId)}
					<button type="button" class:selected={projectId === candidate.projectId} aria-pressed={projectId === candidate.projectId} onclick={() => (projectId = candidate.projectId)}>
						<div class="candidate-head">
							<strong>{candidate.name}</strong>
							{#if candidate.confidence != null}<span>{m.factoryRouting_recommended()}</span>{/if}
							{#if candidate.confidence != null}<em>{m.factoryRouting_confidence({ confidence: String(Math.round(candidate.confidence * 100)) })}</em>{/if}
						</div>
						<code>{candidate.repositoryKey || candidate.key}</code>
						{#if candidate.reason}<p>{candidate.reason}</p>{/if}
					</button>
				{/each}
			</div>
		{:else if mode === 'new_project'}
			<div class="new-project-grid">
				<label>{m.factoryRouting_projectName()}<input bind:value={projectName} maxlength="160" /></label>
				<label>
					{m.factoryRouting_repositoryKey()}
					<select bind:value={repositoryKey} disabled={repositoryKeys.length === 0}>
						{#each repositoryKeys as candidateRepository (candidateRepository)}
							<option value={candidateRepository}>{candidateRepository}</option>
						{/each}
					</select>
				</label>
				<label class="wide">{m.factoryRouting_projectDescription()}<textarea bind:value={projectDescription} maxlength="2000"></textarea></label>
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

		<label class="note">{m.factoryRouting_note()}<textarea bind:value={note} maxlength="4000"></textarea></label>

		<div class="actions">
			<button class="submit" type="button" onclick={submit} disabled={busy || !workforceAvailable || !canEdit}>{m.factoryRouting_submit()}</button>
			{#if !workforceAvailable}<span>{m.workforce_gate_backendUnavailable()}</span>{:else if !canEdit}<span>{m.no_permission()}</span>{/if}
		</div>
		{#if submitError}<p class="error" role="alert">{submitError}</p>{/if}
	</section>
{/if}

<style>
	.routing-panel { border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border)); border-radius: 0.7rem; padding: 1rem; background: linear-gradient(110deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 42%), var(--card); box-shadow: inset 4px 0 0 color-mix(in srgb, var(--accent) 72%, #f59e0b); }
	header { display: flex; align-items: flex-start; gap: 0.75rem; }
	.factory-mark { display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 0.45rem; color: var(--accent); background: var(--background); }
	h2 { color: var(--foreground); font-size: 0.78rem; font-weight: 750; letter-spacing: 0.12em; text-transform: uppercase; }
	header p { margin-top: 0.2rem; max-width: 46rem; color: var(--muted-foreground); font-size: 0.76rem; line-height: 1.45; }
	.mode-row { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 1rem; }
	.mode-row button { display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid var(--border); border-radius: 0.4rem; padding: 0.45rem 0.65rem; color: var(--muted-foreground); background: var(--background); font-size: 0.7rem; font-weight: 650; }
	.mode-row button.active { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--background)); }
	.candidates { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.55rem; margin-top: 0.75rem; }
	.candidates > button { border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.7rem; text-align: left; background: var(--background); }
	.candidates > button.selected { border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent); }
	.candidate-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
	.candidate-head strong { font-size: 0.78rem; }
	.candidate-head span { border-radius: 999px; padding: 0.1rem 0.35rem; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); font-size: 0.55rem; text-transform: uppercase; }
	.candidate-head em { margin-left: auto; color: var(--muted-foreground); font-size: 0.62rem; font-style: normal; }
	.candidates code { display: block; margin-top: 0.3rem; color: var(--muted-foreground); font-size: 0.65rem; }
	.candidates p { margin-top: 0.35rem; color: var(--muted-foreground); font-size: 0.68rem; line-height: 1.35; }
	.new-project-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; margin-top: 0.75rem; }
	.new-project-grid .wide { grid-column: 1 / -1; }
	label { display: flex; flex-direction: column; gap: 0.25rem; color: var(--muted-foreground); font-size: 0.68rem; font-weight: 600; }
	input, select, textarea { width: 100%; border: 1px solid var(--border); border-radius: 0.4rem; padding: 0.5rem 0.6rem; color: var(--foreground); background: var(--background); font-size: 0.75rem; outline: none; }
	input:focus, select:focus, textarea:focus { border-color: var(--accent); }
	select:disabled { cursor: not-allowed; opacity: 0.55; }
	textarea { min-height: 4.5rem; resize: vertical; }
	.scope-field { grid-column: 1 / -1; min-width: 0; }
	.scope-field legend { color: var(--muted-foreground); font-size: 0.68rem; font-weight: 600; }
	.scope-grid { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.25rem; }
	.scope-grid label { position: relative; display: inline-flex; flex-direction: row; align-items: center; border: 1px solid var(--border); border-radius: 999px; padding: 0.3rem 0.55rem; color: var(--muted-foreground); background: var(--background); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.62rem; cursor: pointer; }
	.scope-grid label.checked { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--background)); }
	.scope-grid input { position: absolute; width: 1px; height: 1px; padding: 0; opacity: 0; pointer-events: none; }
	.note { margin-top: 0.75rem; }
	.actions { display: flex; align-items: center; gap: 0.65rem; margin-top: 0.75rem; }
	.submit { border-radius: 0.4rem; padding: 0.5rem 0.75rem; color: var(--background); background: var(--accent); font-size: 0.72rem; font-weight: 750; }
	.submit:disabled { cursor: not-allowed; opacity: 0.45; }
	.actions span { color: var(--muted-foreground); font-size: 0.65rem; }
	.error { margin-top: 0.5rem; color: var(--destructive); font-size: 0.7rem; }
	@media (max-width: 640px) { .new-project-grid { grid-template-columns: 1fr; } .new-project-grid .wide { grid-column: auto; } }
</style>
