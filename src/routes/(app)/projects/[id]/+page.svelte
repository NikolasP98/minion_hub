<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader } from '$lib/components/ui';
	import { Flag, Plus, Clock } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();
	let busy = $state(false);
	let newTaskTitle = $state('');
	let tsMinutes = $state(60);
	let tsDate = $state(new Date().toISOString().slice(0, 10));
	let tsDesc = $state('');

	const COLUMNS = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done'] as const;
	const colLabel: Record<string, string> = {
		backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', in_review: 'In review', blocked: 'Blocked', done: 'Done',
	};
	const projStatuses = ['open', 'active', 'on_hold', 'completed', 'cancelled'];

	const milestones = $derived(data.tasks.filter((t) => t.isMilestone));
	const workTasks = $derived(data.tasks.filter((t) => !t.isMilestone && t.status !== 'cancelled'));
	// Assignee options: me first, then agents.
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
	function hhmm(min: number): string {
		return `${Math.floor(min / 60)}h ${min % 60}m`;
	}

	async function patchTask(id: string, body: Record<string, unknown>) {
		busy = true;
		try {
			const res = await fetch(`/api/project-tasks/${id}`, {
				method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
			});
			if (res.ok) await invalidate('projects:detail');
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
	async function setProjectStatus(status: string) {
		await fetch(`/api/projects/${data.project.id}`, {
			method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
		});
		await invalidate('projects:detail');
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
					<select value={data.project.status} disabled={busy} onchange={(e) => setProjectStatus((e.currentTarget as HTMLSelectElement).value)}>
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
			<button class="btn" disabled={busy || !newTaskTitle.trim()} onclick={() => addTask(false)}><Plus size={15} /> Task</button>
			<button class="btn ghost" disabled={busy || !newTaskTitle.trim()} onclick={() => addTask(true)}><Flag size={14} /> Milestone</button>
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
									<select class="mini" value={t.assigneePartyId ?? ''} disabled={busy} onchange={(e) => patchTask(t.id, { assigneePartyId: (e.currentTarget as HTMLSelectElement).value || null })}>
										<option value="">Unassigned</option>
										{#if t.assigneePartyId && !assignOptions.some((o) => o.id === t.assigneePartyId)}
											<option value={t.assigneePartyId}>{partyName(t.assigneePartyId)}</option>
										{/if}
										{#each assignOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
									</select>
								</div>
								<select class="mini status" value={t.status} disabled={busy} onchange={(e) => patchTask(t.id, { status: (e.currentTarget as HTMLSelectElement).value })}>
									{#each COLUMNS as s (s)}<option value={s}>{colLabel[s]}</option>{/each}
								</select>
							</div>
						{/each}
					</div>
				</div>
			{/each}
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
	.ts { padding: 0.6rem 0.9rem; }
	.ts-add { display: flex; gap: 0.5rem; margin-bottom: 0.6rem; }
	.ts-list { display: flex; flex-direction: column; }
	.ts-row { display: grid; grid-template-columns: 6rem 5rem 7rem 1fr auto; gap: 0.6rem; align-items: center; padding: 0.4rem 0; font-size: 0.84rem; }
	.ts-row + .ts-row { border-top: 1px solid var(--hairline); }
	.mins-v { font-variant-numeric: tabular-nums; font-weight: 600; }
	.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bill { font-size: 0.7rem; color: var(--color-success, #16a34a); border: 1px solid var(--hairline); border-radius: 999px; padding: 0 0.4rem; }
	.empty { padding: 0.75rem 0; }
</style>
