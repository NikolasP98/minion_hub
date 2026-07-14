<script lang="ts">
  import { Button, Select } from '$lib/components/ui';
import type { PageData } from './$types';
	import type { Pipeline } from '@minion-stack/workforce-client';
	import { invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import PipelineStepper from '$lib/components/workforce/PipelineStepper.svelte';
	import {
		emptyDraft,
		draftFromPipeline,
		newStep,
		moveStep,
		draftErrors,
		draftToPayload,
		type Draft,
	} from '$lib/components/workforce/pipeline-draft';

	let { data }: { data: PageData } = $props();

	const ORIGIN_KINDS = ['github_issue', 'manual', 'routine_execution'];
	const PRIORITIES = ['critical', 'high', 'medium', 'low'];
	// index 0 is locked to 'work'; exactly one work step (server-enforced).
	const GATE_KINDS = ['review', 'eval', 'approval'] as const;

	let showArchived = $state(false);
	let selectedId = $state<string | null>(null);
	let draft = $state<Draft>(emptyDraft());
	let busy = $state(false);
	let saveError = $state('');

	const visible = $derived(data.pipelines.filter((p) => showArchived || !p.archivedAt));
	const errors = $derived(draftErrors(draft));
	const canSave = $derived(errors.length === 0 && !busy);

	function agentName(id: string): string {
		return data.agents.find((a) => a.id === id)?.name ?? `${id.slice(0, 8)}…`;
	}

	const previewSteps = $derived(
		draft.steps.map((s, i) => ({
			key: s.key,
			label: s.label.trim() || s.kind,
			who:
				s.participantType === 'agent'
					? s.agentId
						? agentName(s.agentId)
						: '—'
					: m.workforce_pipelines_youHitl(),
			state: (i === 0 ? 'current' : 'pending') as 'current' | 'pending',
		})),
	);

	function select(p: Pipeline) {
		selectedId = p.id;
		draft = draftFromPipeline(p);
		saveError = '';
	}
	function startNew() {
		selectedId = null;
		draft = emptyDraft();
		saveError = '';
	}
	function toggleChip(list: string[], v: string): string[] {
		return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
	}
	function setParticipant(i: number, value: string) {
		const s = draft.steps[i];
		if (value === 'user') {
			s.participantType = 'user';
		} else {
			s.participantType = 'agent';
			s.agentId = value.slice('agent:'.length);
		}
	}
	function triggerChips(p: Pipeline): string[] {
		const t = p.trigger;
		if (!t) return [];
		return [...(t.originKinds ?? []), ...(t.labels ?? []), ...(t.priorities ?? [])];
	}

	async function save() {
		if (!canSave) return;
		busy = true;
		saveError = '';
		try {
			const payload = draftToPayload(draft, data.workforceProjectId);
			const res = selectedId
				? await fetch(`/api/workforce/pipelines/${selectedId}`, {
						method: 'PATCH',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(payload),
					})
				: await fetch(`/api/workforce/companies/${data.companyId}/pipelines`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(payload),
					});
			if (!res.ok) {
				saveError = `${res.status}: ${(await res.text()).slice(0, 300)}`;
				return;
			}
			const saved = (await res.json()) as Pipeline;
			selectedId = saved.id;
			await invalidate('workforce:pipelines');
		} finally {
			busy = false;
		}
	}

	async function toggleArchive(p: Pipeline) {
		busy = true;
		try {
			const res = await fetch(`/api/workforce/pipelines/${p.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ archivedAt: p.archivedAt ? null : new Date().toISOString() }),
			});
			if (res.ok) await invalidate('workforce:pipelines');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{m.workforce_pipelines_title()} · {data.project.name}</title></svelte:head>

<div class="p-6 space-y-6 max-w-6xl">
	<!-- Breadcrumb -->
	<nav class="text-sm text-muted-foreground flex flex-wrap items-center gap-1">
		<a href="/workforce/projects" class="hover:text-foreground">{m.workforce_projects()}</a>
		<span>/</span>
		<a href="/workforce/projects/{data.project.id}" class="hover:text-foreground truncate max-w-[16rem]">{data.project.name}</a>
		<span>/</span>
		<span class="text-foreground">{m.workforce_pipelines_title()}</span>
	</nav>

	<div class="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-6 items-start">
		<!-- Left: pipeline list -->
		<aside class="space-y-3">
			<div class="flex items-center justify-between gap-2">
				<Button variant="ghost" class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" onclick={startNew}>
					{m.workforce_pipelines_new()}
				</Button>
				<label class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<input type="checkbox" bind:checked={showArchived} />
					{m.workforce_pipelines_showArchived()}
				</label>
			</div>
			{#if visible.length === 0}
				<div class="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
					{m.workforce_pipelines_none()}
				</div>
			{:else}
				<ul class="divide-y divide-border rounded-lg border border-border bg-card">
					{#each visible as p (p.id)}
						<li>
							<div class="w-full px-3 py-2.5 text-left text-sm space-y-1 {selectedId === p.id ? 'bg-muted/60' : ''}">
								<Button variant="ghost" class="w-full text-left" onclick={() => select(p)}>
									<div class="flex items-center gap-2">
										<span class="font-medium flex-1 min-w-0 truncate {p.archivedAt ? 'line-through text-muted-foreground' : ''}">{p.name}</span>
										<span class="shrink-0 text-xs text-muted-foreground">{m.workforce_pipelines_stepCount({ count: p.steps.length })}</span>
									</div>
									{#if triggerChips(p).length > 0}
										<div class="flex flex-wrap gap-1 mt-1">
											{#each triggerChips(p) as chip (chip)}
											<span class="rounded-full bg-muted px-1.5 py-0.5 t-telemetry text-muted-foreground">{chip}</span>
											{/each}
										</div>
									{/if}
								</Button>
								<Button variant="ghost"
									class="t-caption text-muted-foreground hover:text-foreground underline-offset-2 hover:underline disabled:opacity-50"
									disabled={busy}
									onclick={() => toggleArchive(p)}
								>{p.archivedAt ? m.workforce_pipelines_unarchive() : m.workforce_pipelines_archive()}</Button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>

		<!-- Right: editor -->
		<section class="rounded-lg border border-border bg-card p-4 space-y-4">
			<!-- name + description -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<label class="block text-xs text-muted-foreground space-y-1">
					<span>{m.workforce_pipelines_name()}</span>
					<input class="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" bind:value={draft.name} />
				</label>
				<label class="block text-xs text-muted-foreground space-y-1">
					<span>{m.workforce_pipelines_description()}</span>
					<input class="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" bind:value={draft.description} />
				</label>
			</div>

			<!-- trigger -->
			<fieldset class="space-y-2">
				<legend class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{m.workforce_pipelines_trigger()}</legend>
				<div class="space-y-1">
					<div class="text-xs text-muted-foreground">{m.workforce_pipelines_originKinds()}</div>
					<div class="flex flex-wrap gap-1.5">
						{#each ORIGIN_KINDS as k (k)}
							<Button variant="ghost"
								class="rounded-full border px-2.5 py-0.5 text-xs {draft.originKinds.includes(k)
									? 'border-[var(--color-info-border)] bg-[var(--color-info-surface)] text-[var(--color-info-fg)]'
									: 'border-border text-muted-foreground'}"
								onclick={() => (draft.originKinds = toggleChip(draft.originKinds, k))}
							>{k}</Button>
						{/each}
					</div>
				</div>
				<div class="space-y-1">
					<div class="text-xs text-muted-foreground">{m.workforce_pipelines_labels()}</div>
					<input
						class="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
						placeholder={m.workforce_pipelines_labelsPlaceholder()}
						bind:value={draft.labels}
					/>
				</div>
				<div class="space-y-1">
					<div class="text-xs text-muted-foreground">{m.workforce_pipelines_priorities()}</div>
					<div class="flex flex-wrap gap-1.5">
						{#each PRIORITIES as k (k)}
							<Button variant="ghost"
								class="rounded-full border px-2.5 py-0.5 text-xs {draft.priorities.includes(k)
									? 'border-[var(--color-info-border)] bg-[var(--color-info-surface)] text-[var(--color-info-fg)]'
									: 'border-border text-muted-foreground'}"
								onclick={() => (draft.priorities = toggleChip(draft.priorities, k))}
							>{k}</Button>
						{/each}
					</div>
				</div>
			</fieldset>

			<!-- steps -->
			<fieldset class="space-y-2">
				<legend class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{m.workforce_pipelines_steps()}</legend>
				<p class="text-xs text-muted-foreground">{m.workforce_pipelines_workLocked()}</p>
				<ol class="space-y-2">
					{#each draft.steps as step, i (step.key)}
						<li class="rounded-md border border-border p-2 space-y-2">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-xs font-mono text-muted-foreground w-5 text-right">{i + 1}.</span>
								<input
									class="flex-1 min-w-[8rem] rounded-md border border-border bg-background px-2 py-1 text-sm"
									placeholder={m.workforce_pipelines_stepLabel()}
									bind:value={step.label}
								/>
								{#if i === 0}
									<Select size="sm" class="rounded-md border border-border bg-background px-2 py-1 text-sm" disabled>
										<option>work</option>
									</Select>
								{:else}
									<Select size="sm" class="rounded-md border border-border bg-background px-2 py-1 text-sm" bind:value={step.kind}>
										{#each GATE_KINDS as k (k)}<option value={k}>{k}</option>{/each}
									</Select>
								{/if}
								<Select size="sm"
									class="rounded-md border border-border bg-background px-2 py-1 text-sm max-w-[12rem]"
									value={step.participantType === 'agent' ? `agent:${step.agentId}` : 'user'}
									onchange={(value) => setParticipant(i, String(value))}
								>
									<option value="agent:" disabled>{m.workforce_pipelines_selectAgent()}</option>
									{#each data.agents as a (a.id)}
										<option value={`agent:${a.id}`}>{a.name}</option>
									{/each}
									{#if i > 0}
										<option value="user">{m.workforce_pipelines_youHitl()}</option>
									{/if}
								</Select>
								<span class="ml-auto flex items-center gap-1">
									<Button variant="ghost"
										class="rounded border border-border px-1.5 py-0.5 text-xs disabled:opacity-40"
										disabled={i <= 1}
										aria-label={m.workforce_pipelines_moveUp()}
										title={m.workforce_pipelines_moveUp()}
										onclick={() => (draft.steps = moveStep(draft.steps, i, -1))}
									>↑</Button>
									<Button variant="ghost"
										class="rounded border border-border px-1.5 py-0.5 text-xs disabled:opacity-40"
										disabled={i === 0 || i === draft.steps.length - 1}
										aria-label={m.workforce_pipelines_moveDown()}
										title={m.workforce_pipelines_moveDown()}
										onclick={() => (draft.steps = moveStep(draft.steps, i, 1))}
									>↓</Button>
									<Button variant="ghost"
										class="rounded border border-border px-1.5 py-0.5 text-xs text-[var(--color-danger-fg)] disabled:opacity-40"
										disabled={i === 0}
										aria-label={m.workforce_pipelines_remove()}
										title={m.workforce_pipelines_remove()}
										onclick={() => (draft.steps = draft.steps.filter((_, j) => j !== i))}
									>✕</Button>
								</span>
							</div>
							{#if step.participantType === 'user'}
								<div class="space-y-1">
									<input
										class="w-full rounded-md border border-border bg-background px-2 py-1 text-sm font-mono"
										placeholder={m.workforce_pipelines_userId()}
										bind:value={step.userId}
									/>
									<p class="t-caption text-muted-foreground">{m.workforce_pipelines_userIdHelp()}</p>
								</div>
							{/if}
							{#if step.kind === 'eval'}
								<div class="space-y-2">
									<textarea
										class="w-full rounded-md border border-border bg-background p-2 text-sm"
										rows="3"
										placeholder={m.workforce_pipelines_rubric()}
										bind:value={step.rubric}
									></textarea>
									<div class="flex items-center gap-3">
										<label class="flex items-center gap-1.5 text-xs text-muted-foreground">
											{m.workforce_pipelines_minScore()}
											<input type="number" class="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm" bind:value={step.minScore} />
										</label>
										<label class="flex items-center gap-1.5 text-xs text-muted-foreground">
											{m.workforce_pipelines_maxScore()}
											<input type="number" class="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm" bind:value={step.maxScore} />
										</label>
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
				<Button variant="ghost"
					class="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
					onclick={() => (draft.steps = [...draft.steps, newStep()])}
				>{m.workforce_pipelines_addStep()}</Button>
			</fieldset>

			<!-- live preview -->
			<div class="space-y-2">
				<h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{m.workforce_pipelines_preview()}</h3>
				<PipelineStepper steps={previewSteps} />
			</div>

			<!-- save -->
			<div class="flex items-center gap-3 pt-2 border-t border-border">
				<Button variant="ghost"
					class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
					disabled={!canSave}
					onclick={save}
				>{m.workforce_pipelines_save()}</Button>
				{#if saveError}<span class="text-xs text-[var(--color-danger-fg)] break-all">{saveError}</span>{/if}
			</div>
		</section>
	</div>
</div>
