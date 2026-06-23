<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Button, Badge, Select, Tabs, EmptyState } from '$lib/components/ui';
	import type { TabItem } from '$lib/components/ui';
	import { Inbox } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	const DOC_LABEL: Record<string, string> = {
		support_issue: 'Ticket',
		crm_contact: 'Lead',
		sales_order: 'Order',
	};

	let tab = $state('queue');
	const tabs: TabItem[] = $derived([
		{ value: 'queue', label: 'My Queue', count: data.items.length },
		...(data.isAdmin ? [{ value: 'rules', label: 'Rules' }] : []),
	]);

	// ── Reassign ────────────────────────────────────────────────────────────────
	async function reassign(docType: string, docId: string, newOwner: string) {
		await fetch('/api/work/reassign', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ docType, docId, newOwner: newOwner || null }),
		});
		await invalidate('work:queue');
	}

	// ── Rules (admin) ─────────────────────────────────────────────────────────────
	let newName = $state('');
	let newDocType = $state('support_issue');
	let newStrategy = $state('round_robin');
	let newAssignees = $state<string[]>([]);
	let busy = $state(false);

	function memberName(id: string) {
		return data.members.find((m) => m.id === id)?.name ?? id;
	}

	async function createRule() {
		if (!newName.trim() || newAssignees.length === 0) return;
		busy = true;
		try {
			const res = await fetch('/api/assignment/rules', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: newName.trim(), docType: newDocType, strategy: newStrategy, assignees: newAssignees }),
			});
			if (res.ok) {
				newName = '';
				newAssignees = [];
				await invalidate('work:queue');
			}
		} finally {
			busy = false;
		}
	}

	async function toggleRule(id: string, enabled: boolean) {
		await fetch(`/api/assignment/rules/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ enabled }),
		});
		await invalidate('work:queue');
	}

	async function deleteRule(id: string) {
		await fetch(`/api/assignment/rules/${id}`, { method: 'DELETE' });
		await invalidate('work:queue');
	}

	function toggleAssignee(id: string) {
		newAssignees = newAssignees.includes(id) ? newAssignees.filter((a) => a !== id) : [...newAssignees, id];
	}
</script>

<PageHeader title="Work" subtitle="Items assigned to you across tickets, leads and orders" />

<Tabs {tabs} bind:value={tab} />

{#if tab === 'queue'}
	{#if data.items.length === 0}
		<EmptyState icon={Inbox} title="Nothing on your plate" description="Assigned tickets, leads and orders will show up here." />
	{:else}
		<div class="queue">
			{#each data.items as it (it.docType + it.id)}
				<div class="row">
					<Badge>{DOC_LABEL[it.docType] ?? it.docType}</Badge>
					<a class="title" href={it.href}>{it.humanId ? `${it.humanId} · ` : ''}{it.title}</a>
					{#if it.status}<span class="status">{it.status}</span>{/if}
					<div class="spacer"></div>
					<Select size="sm" value="" onchange={(v) => reassign(it.docType, it.id, String(v))}>
						<option value="">Reassign…</option>
						{#each data.members as m (m.id)}
							<option value={m.id}>{m.name}</option>
						{/each}
					</Select>
				</div>
			{/each}
		</div>
	{/if}
{:else if tab === 'rules'}
	<div class="rules">
		<p class="muted small"><a href="/settings/workflows">Configure workflows →</a> (role-gated state machines for tickets & orders)</p>
		<div class="card new-rule">
			<h3>New rule</h3>
			<input class="inp" placeholder="Rule name" bind:value={newName} />
			<div class="grid">
				<label>Doc type
					<Select size="sm" bind:value={newDocType}>
						{#each data.docTypes as dt (dt)}<option value={dt}>{DOC_LABEL[dt] ?? dt}</option>{/each}
					</Select>
				</label>
				<label>Strategy
					<Select size="sm" bind:value={newStrategy}>
						<option value="round_robin">Round-robin</option>
						<option value="least_open">Least open</option>
					</Select>
				</label>
			</div>
			<div class="assignees">
				<span class="lbl">Assignees</span>
				{#each data.members as m (m.id)}
					<button type="button" class="chip" class:on={newAssignees.includes(m.id)} onclick={() => toggleAssignee(m.id)}>
						{m.name}
					</button>
				{/each}
			</div>
			<Button onclick={createRule} disabled={busy || !newName.trim() || newAssignees.length === 0}>Create rule</Button>
		</div>

		{#each data.rules as r (r.id)}
			<div class="card rule">
				<div class="rule-head">
					<strong>{r.name}</strong>
					<Badge>{DOC_LABEL[r.docType] ?? r.docType}</Badge>
					<span class="muted">{r.strategy === 'least_open' ? 'least open' : 'round-robin'}</span>
					<div class="spacer"></div>
					<Button size="sm" variant="ghost" onclick={() => toggleRule(r.id, !r.enabled)}>{r.enabled ? 'Disable' : 'Enable'}</Button>
					<Button size="sm" variant="ghost" onclick={() => deleteRule(r.id)}>Delete</Button>
				</div>
				<div class="muted small">{(r.assignees as string[]).map(memberName).join(', ')}</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.queue,
	.rules {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.85rem;
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 0.5rem;
		background: var(--surface, #161616);
	}
	.title {
		font-weight: 500;
		color: inherit;
		text-decoration: none;
	}
	.title:hover {
		text-decoration: underline;
	}
	.status {
		font-size: 0.8rem;
		opacity: 0.7;
		text-transform: capitalize;
	}
	.spacer {
		flex: 1;
	}
	.card {
		padding: 0.85rem 1rem;
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 0.5rem;
		background: var(--surface, #161616);
	}
	.new-rule h3 {
		margin: 0 0 0.6rem;
		font-size: 0.95rem;
	}
	.inp {
		width: 100%;
		padding: 0.45rem 0.6rem;
		margin-bottom: 0.6rem;
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 0.4rem;
		background: var(--bg, #0d0d0d);
		color: inherit;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
		margin-bottom: 0.6rem;
	}
	.grid label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		opacity: 0.85;
	}
	.assignees {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin-bottom: 0.7rem;
	}
	.assignees .lbl {
		font-size: 0.8rem;
		opacity: 0.7;
		margin-right: 0.25rem;
	}
	.chip {
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 1rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.chip.on {
		background: var(--accent, #4f7cff);
		border-color: var(--accent, #4f7cff);
		color: #fff;
	}
	.rule-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.muted {
		opacity: 0.7;
		font-size: 0.85rem;
	}
	.small {
		font-size: 0.78rem;
		margin-top: 0.3rem;
	}
</style>
