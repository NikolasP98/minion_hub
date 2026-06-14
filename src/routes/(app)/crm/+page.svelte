<script lang="ts">
	import type { PageData } from './$types';
	import { goto, invalidate } from '$app/navigation';
	import { Contact, RefreshCw, Plus } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import ScoreBadge from '$lib/components/crm/ScoreBadge.svelte';
	import StagePill from '$lib/components/crm/StagePill.svelte';
	import { relativeTime, contactLabel } from '$lib/components/crm/crm-format';

	let { data }: { data: PageData } = $props();
	const contacts = $derived(data.contacts);
	const tags = $derived(data.tags);
	const f = $derived(data.filters);

	let syncing = $state(false);
	let creating = $state(false);

	const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
	const SORTS = [
		{ v: 'score', label: 'Score' },
		{ v: 'recent', label: 'Last contact' },
		{ v: 'frequency', label: 'Most messages' },
		{ v: 'name', label: 'Name' },
	];

	async function syncNow() {
		syncing = true;
		try {
			const res = await fetch('/api/crm/contacts/sync', { method: 'POST' });
			if (res.ok) await invalidate('crm:contacts');
		} finally {
			syncing = false;
		}
	}

	async function newContact() {
		creating = true;
		try {
			const res = await fetch('/api/crm/contacts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ displayName: 'New contact' }),
			});
			if (res.ok) {
				const { contact } = await res.json();
				await goto(`/crm/${contact.id}`);
			}
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head><title>CRM — Contacts</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title="CRM" subtitle="Customer journeys, ranked by engagement">
		{#snippet leading()}
			<Contact size={16} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<Button variant="outline" size="sm" onclick={syncNow} disabled={syncing}>
				<RefreshCw size={14} class={syncing ? 'animate-spin' : ''} />
				{syncing ? 'Syncing…' : 'Sync now'}
			</Button>
			<Button variant="primary" size="sm" onclick={newContact} disabled={creating}>
				<Plus size={14} /> New
			</Button>
		{/snippet}
	</PageHeader>

	<!-- Filter bar (native GET form → updates URL → reloads ranked list) -->
	<form method="GET" class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--hairline)]">
		<input
			name="search"
			value={f.search ?? ''}
			placeholder="Search name…"
			class="h-8 px-3 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)] min-w-[10rem]"
		/>
		<select name="stage" value={f.stage ?? ''} class="h-8 px-2 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]">
			<option value="">All stages</option>
			{#each STAGES as s (s)}<option value={s}>{s}</option>{/each}
		</select>
		<select name="tagId" value={f.tagId ?? ''} class="h-8 px-2 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]">
			<option value="">All tags</option>
			{#each tags as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
		</select>
		<select name="sort" value={f.sort ?? 'score'} class="h-8 px-2 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]">
			{#each SORTS as s (s.v)}<option value={s.v}>{s.label}</option>{/each}
		</select>
		<Button variant="secondary" size="sm" type="submit">Apply</Button>
		<span class="ml-auto t-caption">{contacts.length} contacts</span>
	</form>

	<!-- Ranked list -->
	<div class="flex-1 min-h-0 overflow-auto">
		{#if contacts.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 text-center p-8">
				<Contact size={32} class="text-muted-foreground" />
				<p class="t-body">No contacts yet.</p>
				<p class="t-caption max-w-sm">
					Contacts appear here once people message your registered channels. Hit
					<strong>Sync now</strong> to harvest them from the message ledger.
				</p>
			</div>
		{:else}
			<table class="w-full text-sm border-collapse">
				<thead class="sticky top-0 bg-bg/90 backdrop-blur z-10">
					<tr class="text-left t-caption border-b border-[var(--hairline)]">
						<th class="px-4 py-2 font-medium">Contact</th>
						<th class="px-3 py-2 font-medium w-24">Score</th>
						<th class="px-3 py-2 font-medium">Stage</th>
						<th class="px-3 py-2 font-medium text-right">Channels</th>
						<th class="px-3 py-2 font-medium text-right">Msgs</th>
						<th class="px-4 py-2 font-medium text-right">Last contact</th>
					</tr>
				</thead>
				<tbody>
					{#each contacts as c (c.contact_id)}
						<tr
							class="border-b border-[var(--hairline)] hover:bg-white/[0.03] cursor-pointer transition-colors"
							onclick={() => goto(`/crm/${c.contact_id}`)}
						>
							<td class="px-4 py-2">
								<div class="font-medium truncate">{contactLabel(c.display_name)}</div>
								{#if c.source === 'manual'}<span class="t-caption">manual</span>{/if}
							</td>
							<td class="px-3 py-2">
								<ScoreBadge score={c.score} r={c.r_score} f={c.f_score} m={c.m_score} />
							</td>
							<td class="px-3 py-2">
								<StagePill stage={c.stage} overridden={false} />
							</td>
							<td class="px-3 py-2 text-right tabular-nums">{c.channels_used}</td>
							<td class="px-3 py-2 text-right tabular-nums">{c.inbound_msgs}/{c.total_msgs}</td>
							<td class="px-4 py-2 text-right t-caption">{relativeTime(c.last_contact_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
