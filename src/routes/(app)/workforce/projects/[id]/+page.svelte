<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader } from '$lib/components/ui';
	import { Flag, Plus, Clock, Boxes, Link2, Unlink, Workflow } from 'lucide-svelte';
	import DocTimeline from '$lib/components/shared/DocTimeline.svelte';
	import { toastWarning } from '$lib/state/ui/toast.svelte';
	import * as m from '$lib/paraglide/messages';
	import { canAct } from '$lib/access/can.svelte';
	import { pipelineColumns, type PipelineColumnBucket, type KanbanIssueLike } from '$lib/components/workforce/pipeline-columns';
	import type { Issue } from '@minion-stack/workforce-client';

	let { data }: { data: PageData } = $props();

	async function postComment(body: string) {
		const res = await fetch('/api/activity/comments', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ refType: 'proj_project', refId: data.project.id, body }),
		});
		if (res.ok) await invalidate('projects:detail');
	}
	let busy = $state(false);
	let newTaskTitle = $state('');
	let tsMinutes = $state(60);
	let tsDate = $state(new Date().toISOString().slice(0, 10));
	let tsDesc = $state('');
	let linkChoice = $state('');

	const COLUMNS = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done'] as const;
	const colLabel: Record<string, string> = {
		backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', in_review: 'In review', blocked: 'Blocked', done: 'Done',
	};
	const projStatuses = ['open', 'active', 'on_hold', 'completed', 'cancelled'];

	const milestones = $derived(data.tasks.filter((t) => t.isMilestone));
	const workTasks = $derived(data.tasks.filter((t) => !t.isMilestone && t.status !== 'cancelled'));
	const assignOptions = $derived([
		...(data.selfPartyId ? [{ id: data.selfPartyId, label: 'Me' }] : []),
		...data.agents.map((a) => ({ id: a.id, label: a.name ?? 'Agent' })),
	]);

	function partyName(id: string | null): string {
		if (!id) return 'Unassigned';
		if (id === data.selfPartyId) return 'Me';
		const p = data.partyMap[id];
		return p?.name ?? (p?.agentId ? 'Agent' : '—');
	}
	function wfAgent(id: string | null): string {
		if (!id) return '—';
		return data.execution?.agentNames[id] ?? `${id.slice(0, 8)}…`;
	}

	// ── pipeline-step kanban (spec §2.1) ──────────────────────────────────
	// Issue list rows carry execution_state scalars not on the client Issue type.
	type IssueRow = Issue & KanbanIssueLike;
	let pipelineChoice = $state('');
	const activePipelines = $derived((data.pipelines ?? []).filter((p) => !p.archivedAt));
	const selectedPipeline = $derived(
		activePipelines.find((p) => p.id === pipelineChoice) ?? activePipelines[0] ?? null,
	);
	const pipelineBoard = $derived(
		selectedPipeline && data.execution
			? pipelineColumns(selectedPipeline.steps, data.execution.issues as IssueRow[])
			: null,
	);
	function pipelineColLabel(col: PipelineColumnBucket<IssueRow>): string {
		switch (col.kind) {
			case 'intake': return m.workforce_kanban_intake();
			case 'step': return selectedPipeline?.steps[col.stepIndex!]?.label ?? '—';
			case 'review': return m.workforce_kanban_inReview();
			case 'done': return m.workforce_kanban_done();
			case 'blocked': return m.workforce_kanban_blocked();
		}
	}
	function hhmm(min: number): string {
		return `${Math.floor(min / 60)}h ${min % 60}m`;
	}

	async function patchTask(id: string, body: Record<string, unknown>, expectedUpdatedAt?: unknown) {
		busy = true;
		try {
			const res = await fetch(`/api/project-tasks/${id}`, {
				method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, expectedUpdatedAt }),
			});
			if (res.status === 409) toastWarning(m.shared_staleWrite());
			if (res.ok || res.status === 409) await invalidate('projects:detail');
		} finally { busy = false; }
	}
	async function addTask(isMilestone = false) {
		if (!newTaskTitle.trim() || busy) return;
		busy = true;
		try {
			const res = await fetch(`/api/projects/${data.project.id}/tasks`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title: newTaskTitle.trim(), isMilestone, status: isMilestone ? 'todo' : 'backlog' }),
			});
			if (res.ok) { newTaskTitle = ''; await invalidate('projects:detail'); }
		} finally { busy = false; }
	}
	async function patchProject(body: Record<string, unknown>) {
		busy = true;
		try {
			const res = await fetch(`/api/projects/${data.project.id}`, {
				method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, expectedUpdatedAt: data.project.updatedAt }),
			});
			if (res.status === 409) toastWarning(m.shared_staleWrite());
			await invalidate('projects:detail');
		} finally { busy = false; }
	}
	async function logTime() {
		if (!data.selfPartyId || tsMinutes <= 0 || busy) return;
		busy = true;
		try {
			const res = await fetch('/api/project-timesheets', {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ partyId: data.selfPartyId, projectId: data.project.id, spentDate: tsDate, minutes: tsMinutes, description: tsDesc || null }),
			});
			if (res.ok) { tsDesc = ''; await invalidate('projects:detail'); }
		} finally { busy = false; }
	}
</script>

<svelte:head><title>{data.project.name}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={data.project.name} subtitle={data.project.humanId ?? undefined} />

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
		<!-- summary -->
		<section class="summary">
			<div class="ring" style={`--pct:${data.progress.percent}`}>
				<span>{data.progress.percent}%</span>
			</div>
			<div class="summary-meta">
				<div class="line"><b>{data.progress.done}</b>/{data.progress.total} tasks done</div>
				<div class="line">Customer: {partyName(data.project.customerPartyId)}</div>
				<div class="line">Lead: {partyName(data.project.leadPartyId)}</div>
				<label class="line">Status:
					<select
						value={data.project.status}
						disabled={busy || !canAct('projects', 'edit')}
						title={canAct('projects', 'edit') ? undefined : m.no_permission()}
						onchange={(e) => patchProject({ status: (e.currentTarget as HTMLSelectElement).value })}
					>
						{#each projStatuses as s (s)}<option value={s}>{s}</option>{/each}
					</select>
				</label>
			</div>
		</section>

		<!-- milestones -->
		<section class="card ms">
			<header class="ms-head"><Flag size={14} /> Milestones</header>
			<div class="ms-list">
				{#each milestones as m (m.id)}
					<span class="ms-chip" class:done={m.status === 'done'}>{m.title}</span>
				{:else}
					<span class="t-caption">No milestones</span>
				{/each}
			</div>
		</section>

		<!-- add task -->
		<div class="add">
			<input class="in" placeholder="Add a task…" bind:value={newTaskTitle} onkeydown={(e) => e.key === 'Enter' && addTask(false)} />
			<button
				class="btn"
				disabled={busy || !newTaskTitle.trim() || !canAct('projects', 'edit')}
				title={canAct('projects', 'edit') ? undefined : m.no_permission()}
				onclick={() => addTask(false)}
			><Plus size={15} /> Task</button>
			<button
				class="btn ghost"
				disabled={busy || !newTaskTitle.trim() || !canAct('projects', 'edit')}
				title={canAct('projects', 'edit') ? undefined : m.no_permission()}
				onclick={() => addTask(true)}
			><Flag size={14} /> Milestone</button>
		</div>

		<!-- board -->
		<section class="board">
			{#each COLUMNS as col (col)}
				<div class="col">
					<header class="col-head">{colLabel[col]} <span class="cnt">{workTasks.filter((t) => t.status === col).length}</span></header>
					<div class="col-body">
						{#each workTasks.filter((t) => t.status === col) as t (t.id)}
							<div class="tcard p-{t.priority}">
								<div class="tt">{t.title}</div>
								<div class="tmeta">
									{#if t.humanId}<span class="hid">{t.humanId}</span>{/if}
									<select
										class="mini"
										value={t.assigneePartyId ?? ''}
										disabled={busy || !canAct('projects', 'edit')}
										title={canAct('projects', 'edit') ? undefined : m.no_permission()}
										onchange={(e) => patchTask(t.id, { assigneePartyId: (e.currentTarget as HTMLSelectElement).value || null }, t.updatedAt)}
									>
										<option value="">Unassigned</option>
										{#if t.assigneePartyId && !assignOptions.some((o) => o.id === t.assigneePartyId)}
											<option value={t.assigneePartyId}>{partyName(t.assigneePartyId)}</option>
										{/if}
										{#each assignOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
									</select>
								</div>
								<select
									class="mini status"
									value={t.status}
									disabled={busy || !canAct('projects', 'edit')}
									title={canAct('projects', 'edit') ? undefined : m.no_permission()}
									onchange={(e) => patchTask(t.id, { status: (e.currentTarget as HTMLSelectElement).value }, t.updatedAt)}
								>
									{#each COLUMNS as s (s)}<option value={s}>{colLabel[s]}</option>{/each}
								</select>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</section>

		<!-- execution layer (paperclip / workforce) -->
		<section class="card exec">
			<header class="exec-head">
				<span><Boxes size={14} /> Execution (workforce)</span>
				{#if data.workforceProjectId}
					<span>
						<a class="btn ghost sm" href={`/workforce/projects/${data.project.id}/pipelines`}>
							<Workflow size={13} /> {m.workforce_pipelines_title()}
						</a>
						<button
							class="btn ghost sm"
							disabled={busy || !canAct('projects', 'edit')}
							title={canAct('projects', 'edit') ? undefined : m.no_permission()}
							onclick={() => patchProject({ workforceProjectId: null })}
						><Unlink size={13} /> Unlink</button>
					</span>
				{/if}
			</header>

			{#if data.execution}
				<div class="exec-meta">
					<span class="font-mono t-caption">{data.execution.project.urlKey}</span>
					<span class="t-caption">lead {wfAgent(data.execution.project.leadAgentId)}</span>
					<span class="t-caption">{data.execution.project.workspaces.length} workspace{data.execution.project.workspaces.length !== 1 ? 's' : ''}</span>
				</div>
				<!-- workspaces -->
				{#if data.execution.project.workspaces.length}
					<div class="ws-list">
						{#each data.execution.project.workspaces as ws (ws.id)}
							<div class="ws">
								<span class="ws-name">{ws.name}{#if ws.isPrimary}<span class="primary">primary</span>{/if}</span>
								<span class="ws-src t-caption">{ws.repoUrl ?? ws.cwd ?? ws.sourceType}</span>
							</div>
						{/each}
					</div>
				{/if}
				<!-- execution kanban: column = pipeline step, card owner = the step's agent -->
				{#if data.execution.issues.length}
					{#if pipelineBoard && selectedPipeline}
						{#if activePipelines.length > 1}
							<label class="exec-meta t-caption">
								{m.workforce_pipelines_title()}
								<select class="mini" bind:value={pipelineChoice}>
									{#each activePipelines as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
								</select>
							</label>
						{/if}
						<div class="board exec-board" style={`grid-template-columns: repeat(${pipelineBoard.length}, minmax(140px, 1fr));`}>
							{#each pipelineBoard as col (col.key)}
								{@const step = col.stepIndex != null ? selectedPipeline.steps[col.stepIndex] : null}
								<div class="col">
									<header class="col-head">{pipelineColLabel(col)} <span class="cnt">{col.issues.length}</span></header>
									<div class="col-body">
										{#each col.issues as iss (iss.id)}
											<a class="tcard iss-card" href={`/workforce/issues/${iss.id}`}>
												<div class="tt">{iss.title}</div>
												<div class="tmeta">
													{#if iss.identifier}<span class="hid">{iss.identifier}</span>{/if}
													{#if step && col.stepIndex != null && col.stepIndex > 0}
														{#if step.participant.type === 'user'}
															<span class="step-chip hitl">{step.label} · {m.workforce_kanban_you()}</span>
														{:else}
															<span class="step-chip review">{step.label} · {wfAgent(step.participant.agentId ?? null)}</span>
														{/if}
													{:else if iss.assigneeAgentId}
														<span class="step-chip">{wfAgent(iss.assigneeAgentId)}</span>
													{:else if iss.assigneeUserId}
														<span class="step-chip hitl">{m.workforce_kanban_you()}</span>
													{/if}
												</div>
											</a>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="board exec-board">
							{#each COLUMNS as col (col)}
								{@const colIssues = data.execution.issues.filter((i) => i.status === col)}
								<div class="col">
									<header class="col-head">{colLabel[col]} <span class="cnt">{colIssues.length}</span></header>
									<div class="col-body">
										{#each colIssues as iss (iss.id)}
											<a class="tcard iss-card" href={`/workforce/issues/${iss.id}`}>
												<div class="tt">{iss.title}</div>
												<div class="tmeta">
													{#if iss.identifier}<span class="hid">{iss.identifier}</span>{/if}
													{#if iss.status === 'in_review' && iss.assigneeUserId}
														<span class="step-chip hitl">HITL approval · you</span>
													{:else if iss.status === 'in_review' && iss.assigneeAgentId}
														<span class="step-chip review">review · {wfAgent(iss.assigneeAgentId)}</span>
													{:else if iss.assigneeAgentId}
														<span class="step-chip">{wfAgent(iss.assigneeAgentId)}</span>
													{:else if iss.assigneeUserId}
														<span class="step-chip hitl">you</span>
													{/if}
												</div>
											</a>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				{:else}
					<p class="t-caption empty">No issues in the linked workforce project.</p>
				{/if}
			{:else if data.workforceProjectId}
				<p class="t-caption broken">Linked workforce project unavailable (backend down or project removed).</p>
			{:else}
				<div class="link-row">
					<select class="in" bind:value={linkChoice}>
						<option value="">Link a workforce project…</option>
						{#each data.linkable as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
					<button
						class="btn ghost sm"
						disabled={busy || !linkChoice || !canAct('projects', 'edit')}
						title={canAct('projects', 'edit') ? undefined : m.no_permission()}
						onclick={() => patchProject({ workforceProjectId: linkChoice })}
					><Link2 size={13} /> Link</button>
				</div>
				{#if data.linkable.length === 0}
					<p class="t-caption empty">No workforce projects available to link.</p>
				{/if}
			{/if}
		</section>

		<!-- timesheets -->
		<section class="card ts">
			<header class="ts-head"><Clock size={14} /> Timesheets</header>
			<div class="ts-add">
				<input class="in date" type="date" bind:value={tsDate} />
				<input class="in mins" type="number" min="1" bind:value={tsMinutes} title="Minutes" />
				<input class="in" placeholder="What did you work on?" bind:value={tsDesc} />
				<button class="btn" disabled={busy || !data.selfPartyId} onclick={logTime}>Log</button>
			</div>
			<div class="ts-list">
				{#each data.timesheets as ts (ts.id)}
					<div class="ts-row">
						<span>{ts.spentDate}</span>
						<span class="mins-v">{hhmm(ts.minutes)}</span>
						<span class="who t-caption">{partyName(ts.partyId)}</span>
						<span class="desc">{ts.description ?? '—'}</span>
						{#if ts.billable}<span class="bill">billable</span>{/if}
					</div>
				{:else}
					<p class="t-caption empty">No time logged yet.</p>
				{/each}
			</div>
		</section>

		<!-- activity + audit -->
		<section class="card">
			<header class="ts-head"><Clock size={14} /> Activity</header>
			<DocTimeline items={data.timeline} onComment={postComment} />
		</section>
	</div>
</div>

<style>
	.summary { display: flex; gap: 1.25rem; align-items: center; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 1rem 1.25rem; }
	.ring { --size: 76px; width: var(--size); height: var(--size); border-radius: 50%; display: grid; place-items: center; background: conic-gradient(var(--color-primary) calc(var(--pct) * 1%), var(--color-bg3) 0); flex: 0 0 auto; }
	.ring span { width: calc(var(--size) - 16px); height: calc(var(--size) - 16px); border-radius: 50%; background: var(--color-card); display: grid; place-items: center; font-weight: 700; font-size: 0.9rem; font-variant-numeric: tabular-nums; }
	.summary-meta { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.86rem; }
	.summary-meta .line { color: var(--color-muted-foreground); }
	.summary-meta select { background: var(--color-bg3); border: 1px solid var(--hairline); border-radius: var(--radius-md); height: 1.7rem; margin-left: 0.3rem; }
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.ms { padding: 0.6rem 0.9rem; }
	.ms-head, .ts-head { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--color-muted-foreground); margin-bottom: 0.5rem; }
	.ms-list { display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.ms-chip { font-size: 0.78rem; padding: 0.15rem 0.55rem; border-radius: 999px; border: 1px solid var(--hairline); background: var(--color-bg3); }
	.ms-chip.done { color: var(--color-success, #16a34a); }
	.add { display: flex; gap: 0.5rem; }
	.in { height: 2rem; font-size: 0.86rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); padding: 0 0.55rem; flex: 1; color: var(--color-foreground); }
	.in.date { flex: 0 0 9rem; } .in.mins { flex: 0 0 5rem; }
	.btn { display: inline-flex; align-items: center; gap: 0.35rem; height: 2rem; padding: 0 0.7rem; border-radius: var(--radius-md); border: 1px solid var(--hairline); background: var(--color-primary); color: var(--color-primary-foreground); font-size: 0.84rem; cursor: pointer; white-space: nowrap; }
	.btn.ghost { background: var(--color-bg3); color: var(--color-foreground); }
	.btn.sm { height: 1.7rem; font-size: 0.78rem; padding: 0 0.55rem; }
	.btn:disabled { opacity: 0.5; cursor: default; }
	.board { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 0.6rem; align-items: start; }
	.col { background: var(--color-bg2, var(--color-bg3)); border: 1px solid var(--hairline); border-radius: var(--radius-lg); min-height: 4rem; }
	.col-head { font-size: 0.76rem; font-weight: 600; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--hairline); display: flex; justify-content: space-between; color: var(--color-muted-foreground); }
	.cnt { font-variant-numeric: tabular-nums; }
	.col-body { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.5rem; }
	.tcard { background: var(--color-card); border: 1px solid var(--hairline); border-left: 3px solid var(--color-muted-foreground); border-radius: var(--radius-md); padding: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; }
	.tcard.p-high { border-left-color: #f59e0b; } .tcard.p-urgent { border-left-color: #ef4444; } .tcard.p-low { border-left-color: var(--hairline); }
	.tt { font-size: 0.83rem; }
	.tmeta { display: flex; align-items: center; gap: 0.35rem; }
	.hid { font-size: 0.7rem; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
	.mini { height: 1.6rem; font-size: 0.74rem; border-radius: var(--radius-sm, 4px); background: var(--color-bg3); border: 1px solid var(--hairline); padding: 0 0.25rem; max-width: 100%; flex: 1; }
	.mini.status { width: 100%; }
	.exec { padding: 0.6rem 0.9rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.exec-head { display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; color: var(--color-muted-foreground); }
	.exec-head > span { display: inline-flex; align-items: center; gap: 0.4rem; }
	.exec-meta { display: flex; flex-wrap: wrap; gap: 0.75rem; }
	.ws-list { display: flex; flex-direction: column; gap: 0.3rem; }
	.ws { display: flex; flex-direction: column; gap: 0.1rem; border: 1px solid var(--hairline); border-radius: var(--radius-md); padding: 0.4rem 0.6rem; }
	.ws-name { font-size: 0.82rem; display: flex; align-items: center; gap: 0.4rem; }
	.primary { font-size: 0.66rem; border-radius: 999px; border: 1px solid var(--hairline); padding: 0 0.35rem; color: var(--color-primary); }
	.ws-src { font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.exec-board { grid-template-columns: repeat(6, minmax(140px, 1fr)); }
	.iss-card { text-decoration: none; color: var(--color-foreground); }
	.iss-card:hover { border-color: var(--color-primary); }
	.step-chip { font-size: 0.68rem; padding: 0.05rem 0.4rem; border-radius: 999px; border: 1px solid var(--hairline); background: var(--color-bg3); color: var(--color-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
	.step-chip.review { color: var(--color-primary); border-color: color-mix(in oklab, var(--color-primary) 40%, transparent); }
	.step-chip.hitl { color: var(--color-warning, #d97706); border-color: color-mix(in oklab, var(--color-warning, #d97706) 40%, transparent); }
	.link-row { display: flex; gap: 0.5rem; align-items: center; }
	.broken { color: var(--color-warning, #d97706); }
	.ts { padding: 0.6rem 0.9rem; }
	.ts-add { display: flex; gap: 0.5rem; margin-bottom: 0.6rem; }
	.ts-list { display: flex; flex-direction: column; }
	.ts-row { display: grid; grid-template-columns: 6rem 5rem 7rem 1fr auto; gap: 0.6rem; align-items: center; padding: 0.4rem 0; font-size: 0.84rem; }
	.ts-row + .ts-row { border-top: 1px solid var(--hairline); }
	.mins-v { font-variant-numeric: tabular-nums; font-weight: 600; }
	.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bill { font-size: 0.7rem; color: var(--color-success, #16a34a); border: 1px solid var(--hairline); border-radius: 999px; padding: 0 0.4rem; }
	.empty { padding: 0.5rem 0; }
</style>
