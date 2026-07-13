<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate, goto } from '$app/navigation';
	import { PageHeader } from '$lib/components/ui';
	import PartyPicker from '$lib/components/crm/PartyPicker.svelte';
	import { GanttChartSquare, FolderPlus, Sparkles, Boxes, FolderGit2, Layers3 } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import { canAct } from '$lib/access/can.svelte';

	let { data }: { data: PageData } = $props();
	let name = $state('');
	let targetDate = $state('');
	let templateId = $state('');
	let customerPartyId = $state<string | null>(null);
	let leadPartyId = $state<string | null>(null);
	let busy = $state(false);

	const statusLabel: Record<string, string> = {
		open: 'Open',
		active: 'Active',
		on_hold: 'On hold',
		completed: 'Completed',
		cancelled: 'Cancelled',
	};

	// paperclip status → native status (import mapping).
	const WF_TO_NATIVE: Record<string, string> = {
		backlog: 'open',
		planned: 'open',
		in_progress: 'active',
		completed: 'completed',
		cancelled: 'cancelled',
	};

	async function create() {
		if (!name.trim() || busy) return;
		busy = true;
		try {
			const res = await fetch('/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					targetDate: targetDate || null,
					customerPartyId,
					leadPartyId,
				}),
			});
			if (res.ok) {
				name = '';
				targetDate = '';
				customerPartyId = null;
				leadPartyId = null;
				await invalidate('projects:list');
			}
		} finally {
			busy = false;
		}
	}

	async function instantiate() {
		if (!templateId || busy) return;
		busy = true;
		try {
			const res = await fetch(`/api/project-templates/${templateId}/instantiate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ baseDate: new Date().toISOString().slice(0, 10) }),
			});
			if (res.ok) {
				const { project } = await res.json();
				await goto(`/workforce/projects/${project.id}`);
			}
		} finally {
			busy = false;
		}
	}

	// Import a paperclip project as a native project linked to its execution layer.
	async function importWorkforce(p: { id: string; name: string; status: string; targetDate: string | null; color: string | null }) {
		if (busy) return;
		busy = true;
		try {
			const res = await fetch('/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: p.name,
					status: WF_TO_NATIVE[p.status] ?? 'open',
					targetDate: p.targetDate,
					color: p.color,
					workforceProjectId: p.id,
				}),
			});
			if (res.ok) {
				const project = await res.json();
				await goto(`/workforce/projects/${project.id}`);
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Projects</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title="Projects" subtitle="Where people and agents do the work — tasks, milestones, timesheets, execution" />

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
		{#if !data.workforceAvailable}
			<div class="offline" role="status"><Boxes size={15} /> {m.workforce_projects_executionUnavailable()}</div>
		{/if}
		<div class="kpis">
			<div class="kpi"><GanttChartSquare size={16} /><span class="n">{data.stats.total}</span><span class="l">Projects</span></div>
			<div class="kpi"><span class="n">{data.stats.active}</span><span class="l">Active</span></div>
			<div class="kpi"><span class="n">{data.stats.open}</span><span class="l">Open</span></div>
		</div>

		<section class="card creator">
			<div class="create-row">
				<input class="in" placeholder="New project name…" bind:value={name} onkeydown={(e) => e.key === 'Enter' && create()} />
				<input class="in date" type="date" bind:value={targetDate} title="Target date" />
				<button
					class="btn"
					disabled={busy || !name.trim() || !canAct('projects', 'edit')}
					title={canAct('projects', 'edit') ? undefined : m.no_permission()}
					onclick={create}
				><FolderPlus size={15} /> Create</button>
			</div>
			<div class="create-row">
				<PartyPicker bind:value={customerPartyId} label="Customer" placeholder="Search customer…" types="person,company" />
				<PartyPicker bind:value={leadPartyId} label="Lead" placeholder="Search lead (person or agent)…" types="person,agent" />
			</div>
			{#if data.templates.length}
				<div class="create-row">
					<select class="in" bind:value={templateId}>
						<option value="">From template…</option>
						{#each data.templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
					</select>
					<button class="btn ghost" disabled={busy || !templateId} onclick={instantiate}><Sparkles size={15} /> Instantiate</button>
				</div>
			{/if}
		</section>

		<section class="card list">
			{#each data.projects as p (p.id)}
				<a class="row" href={`/workforce/projects/${p.id}`}>
					<span class="name">{#if p.humanId}<span class="hid">{p.humanId}</span> {/if}{p.name}</span>
					<span class="status s-{p.status}">{statusLabel[p.status] ?? p.status}</span>
					<span class="target t-caption">{p.targetDate ?? '—'}</span>
				</a>
			{:else}
				<p class="t-caption empty">No projects yet. Create one above, or instantiate a template.</p>
			{/each}
		</section>

		<!-- Paperclip execution-layer projects not yet linked to a native project. -->
		{#if data.workforceGroups.length}
			<section class="wf-registry" aria-labelledby="execution-projects-title">
				<header class="wf-registry-head">
					<span id="execution-projects-title"><Boxes size={14} /> {m.workforce_projects_executionProjects()}</span>
					<span class="t-caption">{m.workforce_projects_unlinkedHint()}</span>
				</header>
				{#each data.workforceGroups as repository (repository.key)}
					<article class="card wf-repository">
						<header class="wf-repository-head">
							<span class="wf-repository-icon"><FolderGit2 size={15} /></span>
							<span class="wf-kind">{m.workforce_projects_repository()}</span>
							<strong>{repository.repositoryKey ?? m.workforce_projects_ungroupedRepository()}</strong>
						</header>
						{#each repository.groups as group (group.key)}
							<section class="wf-concern">
								<header class="wf-concern-head">
									<span class="wf-concern-icon"><Layers3 size={12} /></span>
									<span class="wf-kind">{m.workforce_projects_concern()}</span>
									<span>{group.groupKey ?? m.workforce_projects_ungroupedConcern()}</span>
								</header>
								{#each group.projects as p (p.id)}
									<div class="wf-row">
										<span class="name">
											{#if p.color}<span class="dot" style="background:{p.color}"></span>{/if}{p.name}
										</span>
										<span class="status t-caption">{p.status}</span>
										<button
											class="btn ghost sm"
											disabled={busy || !canAct('projects', 'edit')}
											title={canAct('projects', 'edit') ? undefined : m.no_permission()}
											onclick={() => importWorkforce(p)}
										>{m.workforce_projects_import()}</button>
									</div>
								{/each}
							</section>
						{/each}
					</article>
				{/each}
			</section>
		{/if}
	</div>
</div>

<style>
	.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; max-width: 36rem; }
	.kpi { display: flex; align-items: center; gap: 0.5rem; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.75rem 1rem; color: var(--color-muted-foreground); }
	.kpi .n { font-size: 1.3rem; font-weight: 700; color: var(--color-foreground); font-variant-numeric: tabular-nums; margin-left: auto; }
	.kpi .l { font-size: 0.74rem; }
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.creator { padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.create-row { display: flex; gap: 0.5rem; align-items: center; }
	.in { height: 2rem; font-size: 0.86rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); padding: 0 0.55rem; flex: 1; color: var(--color-foreground); }
	.in.date { flex: 0 0 9rem; }
	.btn { display: inline-flex; align-items: center; gap: 0.35rem; height: 2rem; padding: 0 0.7rem; border-radius: var(--radius-md); border: 1px solid var(--hairline); background: var(--color-primary); color: var(--color-primary-foreground); font-size: 0.84rem; cursor: pointer; }
	.btn.ghost { background: var(--color-bg3); color: var(--color-foreground); }
	.btn.sm { height: 1.7rem; font-size: 0.78rem; padding: 0 0.55rem; }
	.btn:disabled { opacity: 0.5; cursor: default; }
	.list { display: flex; flex-direction: column; padding: 0.25rem 0; }
	.row { display: grid; grid-template-columns: 1fr 8rem 7rem; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; font-size: 0.88rem; color: var(--color-foreground); text-decoration: none; }
	.row + .row { border-top: 1px solid var(--hairline); }
	.row:hover { background: var(--color-bg3); }
	.hid { font-variant-numeric: tabular-nums; color: var(--color-muted-foreground); font-size: 0.78rem; }
	.status { font-size: 0.76rem; padding: 0.12rem 0.5rem; border-radius: 999px; border: 1px solid var(--hairline); justify-self: start; }
	.s-active { color: var(--color-success, #16a34a); }
	.s-completed { color: var(--color-muted-foreground); }
	.s-cancelled { color: var(--color-muted-foreground); text-decoration: line-through; }
	.target { justify-self: end; font-variant-numeric: tabular-nums; }
	.empty { padding: 1.25rem 1rem; }
	.offline { display: flex; align-items: center; gap: 0.45rem; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-bg3); color: var(--color-muted-foreground); padding: 0.65rem 0.8rem; font-size: 0.8rem; }
	.wf-registry { display: flex; flex-direction: column; gap: 0.65rem; }
	.wf-registry-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0 0.15rem; color: var(--color-muted-foreground); }
	.wf-registry-head > span:first-child { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; font-weight: 600; color: var(--color-foreground); }
	.wf-repository { overflow: hidden; }
	.wf-repository-head { display: flex; align-items: center; gap: 0.45rem; min-height: 2.4rem; padding: 0.55rem 0.8rem; border-bottom: 1px solid var(--hairline); background: linear-gradient(90deg, color-mix(in oklab, var(--color-primary) 8%, var(--color-bg3)), var(--color-card) 55%); }
	.wf-repository-icon { display: inline-flex; color: var(--color-primary); }
	.wf-repository-head strong { font-family: monospace; font-size: 0.82rem; letter-spacing: 0.015em; }
	.wf-kind { color: var(--color-muted-foreground); font-size: 0.65rem; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; }
	.wf-concern + .wf-concern { border-top: 1px solid var(--hairline); }
	.wf-concern-head { display: flex; align-items: center; gap: 0.4rem; padding: 0.45rem 1rem 0.3rem; color: var(--color-muted-foreground); font-family: monospace; font-size: 0.72rem; }
	.wf-concern-icon { display: inline-flex; color: var(--color-muted-foreground); }
	.wf-row { display: grid; grid-template-columns: 1fr 8rem auto; align-items: center; gap: 0.75rem; padding: 0.5rem 1rem; font-size: 0.86rem; }
	.wf-row + .wf-row { border-top: 1px solid color-mix(in oklab, var(--hairline) 70%, transparent); }
	.wf-row:hover { background: var(--color-bg3); }
	.name { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
	.dot { width: 0.6rem; height: 0.6rem; border-radius: 999px; flex: 0 0 auto; }
</style>
