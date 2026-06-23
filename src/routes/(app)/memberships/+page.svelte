<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Button, Badge, Select, Tabs, EmptyState } from '$lib/components/ui';
	import type { TabItem } from '$lib/components/ui';
	import { RefreshCw } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	let tab = $state('members');
	const tabs: TabItem[] = $derived([
		{ value: 'members', label: 'Members', count: data.members.length },
		...(data.isAdmin ? [{ value: 'plans', label: 'Plans', count: data.plans.length }] : []),
	]);

	function planName(id: string) {
		return data.plans.find((p) => p.id === id)?.name ?? id;
	}
	function fmtDate(s: string | Date | null) {
		return s ? new Date(s).toLocaleDateString() : '—';
	}

	// ── New membership ────────────────────────────────────────────────────────────
	let newPlanId = $state('');
	let newCustomer = $state('');
	let busy = $state(false);

	async function createMembership() {
		if (!newPlanId) return;
		busy = true;
		try {
			const res = await fetch('/api/memberships', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ planId: newPlanId, customerName: newCustomer.trim() || null }),
			});
			if (res.ok) {
				newCustomer = '';
				await invalidate('memberships:list');
			}
		} finally {
			busy = false;
		}
	}

	async function setStatus(id: string, status: string) {
		await fetch(`/api/memberships/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status }),
		});
		await invalidate('memberships:list');
	}

	// ── New plan (admin) ────────────────────────────────────────────────────────────
	let pName = $state('');
	let pPrice = $state('');
	let pCurrency = $state('PEN');
	let pUnit = $state('month');
	let pCount = $state(1);

	async function createPlan() {
		if (!pName.trim()) return;
		busy = true;
		try {
			const res = await fetch('/api/memberships/plans', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: pName.trim(),
					price: pPrice ? Number(pPrice) : null,
					currency: pCurrency || null,
					intervalUnit: pUnit,
					intervalCount: Number(pCount) || 1,
				}),
			});
			if (res.ok) {
				pName = '';
				pPrice = '';
				await invalidate('memberships:list');
			}
		} finally {
			busy = false;
		}
	}

	async function togglePlan(id: string, enabled: boolean) {
		await fetch(`/api/memberships/plans/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ enabled }),
		});
		await invalidate('memberships:list');
	}
</script>

<PageHeader title="Memberships" subtitle="Recurring plans — each cycle spawns a draft sales order for billing" />

<Tabs {tabs} bind:value={tab} />

{#if tab === 'members'}
	<div class="stack">
		{#if data.plans.length}
			<div class="card row new">
				<Select size="sm" bind:value={newPlanId}>
					<option value="">Choose plan…</option>
					{#each data.plans as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</Select>
				<input class="inp" placeholder="Customer name" bind:value={newCustomer} />
				<Button onclick={createMembership} disabled={busy || !newPlanId}>Add member</Button>
			</div>
		{/if}

		{#if data.members.length === 0}
			<EmptyState icon={RefreshCw} title="No memberships yet" description="Create a plan, then enroll members." />
		{:else}
			{#each data.members as m (m.id)}
				<div class="card row">
					<strong>{m.customerName ?? 'Member'}</strong>
					<Badge>{planName(m.planId)}</Badge>
					<span class="muted">{m.status}</span>
					<span class="muted small">next: {fmtDate(m.nextCycleDate)} · {m.cycleNo} cycles</span>
					<div class="spacer"></div>
					{#if m.status === 'active'}
						<Button size="sm" variant="ghost" onclick={() => setStatus(m.id, 'paused')}>Pause</Button>
						<Button size="sm" variant="ghost" onclick={() => setStatus(m.id, 'cancelled')}>Cancel</Button>
					{:else if m.status === 'paused'}
						<Button size="sm" variant="ghost" onclick={() => setStatus(m.id, 'active')}>Resume</Button>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
{:else if tab === 'plans'}
	<div class="stack">
		<div class="card new-plan">
			<h3>New plan</h3>
			<div class="grid">
				<label>Name<input class="inp" bind:value={pName} /></label>
				<label>Price<input class="inp" type="number" bind:value={pPrice} /></label>
				<label>Currency<input class="inp" bind:value={pCurrency} /></label>
				<label>Every
					<div class="every">
						<input class="inp narrow" type="number" min="1" bind:value={pCount} />
						<Select size="sm" bind:value={pUnit}>
							<option value="day">day(s)</option>
							<option value="week">week(s)</option>
							<option value="month">month(s)</option>
							<option value="year">year(s)</option>
						</Select>
					</div>
				</label>
			</div>
			<Button onclick={createPlan} disabled={busy || !pName.trim()}>Create plan</Button>
		</div>

		{#each data.plans as p (p.id)}
			<div class="card row">
				<strong>{p.name}</strong>
				<span class="muted">{p.price ?? '—'} {p.currency ?? ''} · every {p.intervalCount} {p.intervalUnit}</span>
				{#if !p.enabled}<Badge>disabled</Badge>{/if}
				<div class="spacer"></div>
				<Button size="sm" variant="ghost" onclick={() => togglePlan(p.id, !p.enabled)}>{p.enabled ? 'Disable' : 'Enable'}</Button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.stack { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
	.card { padding: 0.7rem 0.9rem; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--color-bg2); }
	.row { display: flex; align-items: center; gap: 0.6rem; }
	.new { flex-wrap: wrap; }
	.spacer { flex: 1; }
	.muted { opacity: 0.7; font-size: 0.86rem; }
	.small { font-size: 0.78rem; }
	.new-plan h3 { margin: 0 0 0.6rem; font-size: 0.95rem; }
	.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin-bottom: 0.6rem; }
	.grid label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; opacity: 0.9; }
	.every { display: flex; gap: 0.4rem; }
	.inp { padding: 0.4rem 0.55rem; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--color-bg3); color: inherit; font-size: 0.86rem; }
	.narrow { width: 4rem; }
</style>
