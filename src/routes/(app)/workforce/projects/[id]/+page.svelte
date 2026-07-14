<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Button, Select } from '$lib/components/ui';
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
		...(data.selfPartyId ? [{ id: data.selfPartyId, label: 'Me', agent: false }] : []),
		...data.agents.map((a) => ({ id: a.id, label: a.name ?? 'Agent', agent: true })),
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
					<Select size="sm"
						value={data.project.status}
						disabled={busy || !canAct('projects', 'edit')}
						title={canAct('projects', 'edit') ? undefined : m.no_permission()}
						onchange={(value) => patchProject({ status: String(value) })}
					>
						{#each projStatuses as s (s)}<option value={s}>{s}</option>{/each}
					</Select>
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
			<Button variant="ghost"
				class="btn"
				disabled={busy || !newTaskTitle.trim() || !canAct('projects', 'edit')}
				title={canAct('projects', 'edit') ? undefined : m.no_permission()}
				onclick={() => addTask(false)}
			><Plus size={15} /> Task</Button>
			<Button variant="ghost"
				class="btn ghost"
				disabled={busy || !newTaskTitle.trim() || !canAct('projects', 'edit')}
				title={canAct('projects', 'edit') ? undefined : m.no_permission()}
				onclick={() => addTask(true)}
			><Flag size={14} /> Milestone</Button>
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
									<Select size="sm"
										class="mini"
										value={t.assigneePartyId ?? ''}
										disabled={busy || !canAct('projects', 'edit')}
										title={canAct('projects', 'edit') ? undefined : m.no_permission()}
										onchange={(value) => patchTask(t.id, { assigneePartyId: String(value) || null }, t.updatedAt)}
									>
										<option value="">Unassigned</option>
										{#if t.assigneePartyId && !assignOptions.some((o) => o.id === t.assigneePartyId)}
											<option value={t.assigneePartyId}>{partyName(t.assigneePartyId)}</option>
										{/if}
										{#each assignOptions as o (o.id)}<option value={o.id} disabled={!!o.agent && !data.workforceAvailable}>{o.label}{#if o.agent && !data.workforceAvailable} — {m.workforce_projects_agentUnavailable()}{/if}</option>{/each}
									</Select>
								</div>
								<Select size="sm"
									class="mini status"
									value={t.status}
									disabled={busy || !canAct('projects', 'edit')}
									title={canAct('projects', 'edit') ? undefined : m.no_permission()}
									onchange={(value) => patchTask(t.id, { status: String(value) }, t.updatedAt)}
								>
									{#each COLUMNS as s (s)}<option value={s}>{colLabel[s]}</option>{/each}
								</Select>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</section>

		<!-- execution layer (paperclip / workforce) -->
		<section class="card exec" class:offline={!data.workforceAvailable}>
			<header class="exec-head">
				<span><Boxes size={14} /> Execution (workforce)</span>
				{#if data.workforceProjectId}
					<span>
						{#if data.workforceAvailable}
							<a class="btn ghost sm" href={`/workforce/projects/${data.project.id}/pipelines`}>
								<Workflow size={13} /> {m.workforce_pipelines_title()}
							</a>
						{:else}
							<span class="btn ghost sm disabled" aria-disabled="true"><Workflow size={13} /> {m.workforce_pipelines_title()}</span>
						{/if}
						<Button variant="ghost"
							class="btn ghost sm"
							disabled={busy || !data.workforceAvailable || !canAct('projects', 'edit')}
							title={canAct('projects', 'edit') ? undefined : m.no_permission()}
							onclick={() => patchProject({ workforceProjectId: null })}
						><Unlink size={13} /> Unlink</Button>
					</span>
				{/if}
			</header>
			{#if data.harnessRoster.length}
				<div class="t-caption">{m.workforce_harness_executionRoster()}</div>
				<div class="roster">
					{#each data.harnessRoster as harness (harness.agentId)}
						<a class="agent-card" class:disabled={!data.workforceAvailable} href={data.workforceAvailable ? `/workforce/agents/${harness.agentId}` : undefined} aria-disabled={!data.workforceAvailable}>
							<span class="agent-name">{harness.name}</span>
							<span class="t-caption font-mono">{harness.activePrimary?.model ?? m.workforce_harness_offline()}</span>
							<span class="t-caption">r{harness.revision ?? '?'} · {harness.performance.successRate == null ? '—' : `${Math.round(harness.performance.successRate * 100)}%`}</span>
						</a>
					{/each}
				</div>
			{/if}

			{#if !data.workforceAvailable}
				<p class="t-caption empty">{m.workforce_projects_executionUnavailable()}</p>
			{:else if data.execution}
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
								<Select size="sm" class="mini" bind:value={pipelineChoice}>
									{#each activePipelines as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
								</Select>
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
					<Select size="sm" class="in" bind:value={linkChoice}>
						<option value="">Link a workforce project…</option>
						{#each data.linkable as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</Select>
					<Button variant="ghost"
						class="btn ghost sm"
						disabled={busy || !linkChoice || !canAct('projects', 'edit')}
						title={canAct('projects', 'edit') ? undefined : m.no_permission()}
						onclick={() => patchProject({ workforceProjectId: linkChoice })}
					><Link2 size={13} /> Link</Button>
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
				<Button variant="ghost" class="btn" disabled={busy || !data.selfPartyId} onclick={logTime}>Log</Button>
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
	.summary { display: flex; gap: var(--space-6); align-items: center; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: var(--space-4) var(--space-6); }
	.ring { --size: 76px; width: var(--size); height: var(--size); border-radius: var(--radius-full); display: grid; place-items: center; background: conic-gradient(var(--color-accent) calc(var(--pct) * 1%), var(--color-bg3) 0); flex: 0 0 auto; }
	.ring span { width: calc(var(--size) - 16px); height: calc(var(--size) - 16px); border-radius: var(--radius-full); background: var(--color-card); display: grid; place-items: center; font-weight: 700; font-size: var(--font-size-page-title); font-variant-numeric: tabular-nums; }
	.summary-meta { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--font-size-body); }
	.summary-meta .line { color: var(--color-muted-foreground); }
	.summary-meta :global([data-part='select']) { background: var(--color-bg3); border: 1px solid var(--hairline); border-radius: var(--radius-md); height: 1.7rem; margin-left: var(--space-1); }
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.ms { padding: var(--space-2) var(--space-4); }
	.ms-head, .ts-head { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-body); color: var(--color-muted-foreground); margin-bottom: var(--space-2); }
	.ms-list { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.ms-chip { font-size: var(--font-size-body); padding: var(--space-1) var(--space-2); border-radius: var(--radius-full); border: 1px solid var(--hairline); background: var(--color-bg3); }
	.ms-chip.done { color: var(--color-success, var(--color-success-border)); }
	.add { display: flex; gap: var(--space-2); }
	.in { height: 2rem; font-size: var(--font-size-body); border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); padding: 0 var(--space-2); flex: 1; color: var(--color-foreground); }
	.in.date { flex: 0 0 9rem; } .in.mins { flex: 0 0 5rem; }
	.btn { display: inline-flex; align-items: center; gap: var(--space-2); height: 2rem; padding: 0 var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--hairline); background: var(--color-accent); color: var(--color-on-accent); font-size: var(--font-size-body); cursor: pointer; white-space: nowrap; }
	.btn.ghost { background: var(--color-bg3); color: var(--color-foreground); }
	.btn.sm { height: 1.7rem; font-size: var(--font-size-body); padding: 0 var(--space-2); }
	.btn:disabled { opacity: 0.5; cursor: default; }
	.btn.disabled { opacity: 0.5; cursor: default; }
	.board { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: var(--space-2); align-items: start; overflow-x: auto; overscroll-behavior-inline: contain; padding-bottom: var(--space-2, 8px); }
	.col { background: var(--color-bg2, var(--color-bg3)); border: 1px solid var(--hairline); border-radius: var(--radius-lg); min-height: 4rem; }
	.col-head { font-size: var(--font-size-body); font-weight: 600; padding: var(--space-2) var(--space-2); border-bottom: 1px solid var(--hairline); display: flex; justify-content: space-between; color: var(--color-muted-foreground); }
	.cnt { font-variant-numeric: tabular-nums; }
	.col-body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); }
	.tcard { background: var(--color-card); border: 1px solid var(--hairline); border-left: 3px solid var(--color-muted-foreground); border-radius: var(--radius-md); padding: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); }
	.tcard.p-high { border-left-color: var(--color-warning-fg); } .tcard.p-urgent { border-left-color: var(--color-danger-fg); } .tcard.p-low { border-left-color: var(--hairline); }
	.tt { font-size: var(--font-size-body); }
	.tmeta { display: flex; align-items: center; gap: var(--space-2); }
	.hid { font-size: var(--font-size-caption); color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
	.mini { height: 1.6rem; font-size: var(--font-size-caption); border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); padding: 0 var(--space-1); max-width: 100%; flex: 1; }
	.mini.status { width: 100%; }
	.exec { padding: var(--space-2) var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
	.exec.offline { opacity: 0.65; background: var(--color-bg3); }
	.roster { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-2); }
	.agent-card { display: grid; grid-template-columns: 1fr auto; gap: var(--space-1) var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-md); padding: var(--space-2) var(--space-2); color: var(--color-foreground); text-decoration: none; }
	.agent-card:hover { border-color: var(--color-accent); }
	.agent-card.disabled { pointer-events: none; filter: grayscale(1); }
	.agent-name { grid-column: 1 / -1; font-size: var(--font-size-body); font-weight: 600; }
	.exec-head { display: flex; align-items: center; justify-content: space-between; font-size: var(--font-size-body); color: var(--color-muted-foreground); }
	.exec-head > span { display: inline-flex; align-items: center; gap: var(--space-2); }
	.exec-meta { display: flex; flex-wrap: wrap; gap: var(--space-3); }
	.ws-list { display: flex; flex-direction: column; gap: var(--space-1); }
	.ws { display: flex; flex-direction: column; gap: var(--space-0-5); border: 1px solid var(--hairline); border-radius: var(--radius-md); padding: var(--space-2) var(--space-2); }
	.ws-name { font-size: var(--font-size-body); display: flex; align-items: center; gap: var(--space-2); }
	.primary { font-size: var(--font-size-caption); border-radius: var(--radius-full); border: 1px solid var(--hairline); padding: 0 var(--space-2); color: var(--color-accent); }
	.ws-src { font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.exec-board { grid-template-columns: repeat(6, minmax(140px, 1fr)); }
	.iss-card { text-decoration: none; color: var(--color-foreground); }
	.iss-card:hover { border-color: var(--color-accent); }
	.step-chip { font-size: var(--font-size-caption); padding: var(--space-0-5) var(--space-2); border-radius: var(--radius-full); border: 1px solid var(--hairline); background: var(--color-bg3); color: var(--color-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
	.step-chip.review { color: var(--color-accent); border-color: color-mix(in oklab, var(--color-accent) 40%, transparent); }
	.step-chip.hitl { color: var(--color-warning, var(--color-warning-border)); border-color: color-mix(in oklab, var(--color-warning, var(--color-warning-border)) 40%, transparent); }
	.link-row { display: flex; gap: var(--space-2); align-items: center; }
	.broken { color: var(--color-warning, var(--color-warning-border)); }
	.ts { padding: var(--space-2) var(--space-4); }
	.ts-add { display: flex; gap: var(--space-2); margin-bottom: var(--space-2); }
	.ts-list { display: flex; flex-direction: column; }
	.ts-row { display: grid; grid-template-columns: 6rem 5rem 7rem 1fr auto; gap: var(--space-2); align-items: center; padding: var(--space-2) 0; font-size: var(--font-size-body); }
	.ts-row + .ts-row { border-top: 1px solid var(--hairline); }
	.mins-v { font-variant-numeric: tabular-nums; font-weight: 600; }
	.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bill { font-size: var(--font-size-caption); color: var(--color-success, var(--color-success-border)); border: 1px solid var(--hairline); border-radius: var(--radius-full); padding: 0 var(--space-2); }
	.empty { padding: var(--space-2) 0; }
	@media (max-width: 767.98px) {
		.summary { align-items: flex-start; padding: var(--space-card, 16px); }
		.add, .link-row, .ts-add { align-items: stretch; flex-direction: column; }
		.in.date, .in.mins { flex-basis: auto; width: 100%; }
		.board { scroll-snap-type: inline proximity; }
		.col { min-width: min(78vw, 280px); scroll-snap-align: start; }
		.exec-head { align-items: flex-start; flex-direction: column; gap: var(--space-2, 8px); }
		.ts-row {
			grid-template-columns: 1fr auto;
			gap: var(--space-1, 4px) var(--space-2, 8px);
			padding: var(--space-2, 8px) 0;
		}
		.ts-row .who, .ts-row .desc { grid-column: 1 / -1; }
		.ts-row .bill { grid-column: 2; grid-row: 1; }
	}
</style>
