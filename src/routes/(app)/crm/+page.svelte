<script lang="ts">
	import type { PageData } from './$types';
	import { goto, invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { Contact, RefreshCw, Plus, Tags } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import ScoreBadge from '$lib/components/crm/ScoreBadge.svelte';
	import StagePill from '$lib/components/crm/StagePill.svelte';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
	import Highlight from '$lib/components/crm/Highlight.svelte';
	import { relativeTime, contactLabel } from '$lib/components/crm/crm-format';
	import { stageLabel } from '$lib/components/crm/crm-i18n';

	let { data }: { data: PageData } = $props();
	const contacts = $derived(data.contacts);
	const tags = $derived(data.tags);

	// Filter/sort state — all client-side over the (Valkey-cached) full roster, so
	// every keystroke / change is instant with no server round-trip and no Apply.
	let search = $state('');
	let stage = $state('');
	let tagId = $state('');
	let sort = $state<'score' | 'recent' | 'frequency' | 'name'>('score');

	let syncing = $state(false);
	let creating = $state(false);

	const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
	const SORTS = [
		{ v: 'score', label: () => m.crm_col_score() },
		{ v: 'recent', label: () => m.crm_col_last_contact() },
		{ v: 'frequency', label: () => m.crm_col_msgs() },
		{ v: 'name', label: () => m.crm_col_contact() },
	] as const;

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		let list = contacts;
		if (q) list = list.filter((c) => (c.display_name ?? '').toLowerCase().includes(q));
		if (stage) list = list.filter((c) => c.stage === stage);
		if (tagId) list = list.filter((c) => c.tag_ids?.includes(tagId));

		const name = (c: (typeof contacts)[number]) => (c.display_name ?? '￿').toLowerCase();
		const byName = (a: (typeof contacts)[number], b: (typeof contacts)[number]) =>
			name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0;
		const sorted = [...list];
		if (sort === 'name') sorted.sort(byName);
		else if (sort === 'frequency') sorted.sort((a, b) => b.total_msgs - a.total_msgs || byName(a, b));
		else if (sort === 'recent')
			sorted.sort(
				(a, b) =>
					(b.last_contact_at ? Date.parse(b.last_contact_at) : -Infinity) -
						(a.last_contact_at ? Date.parse(a.last_contact_at) : -Infinity) || byName(a, b),
			);
		else sorted.sort((a, b) => b.score - a.score || byName(a, b));
		return sorted;
	});

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
				body: JSON.stringify({ displayName: m.crm_new_contact() }),
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

<svelte:head><title>{m.crm_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.crm_title()} subtitle={m.crm_subtitle()}>
		{#snippet leading()}
			<Contact size={16} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<a href="/crm/settings" class="p-1.5 rounded hover:bg-white/[0.06] inline-flex" aria-label={m.crm_tags_title()} title={m.crm_tags_title()}>
				<Tags size={16} />
			</a>
			<Button variant="outline" size="sm" onclick={syncNow} disabled={syncing}>
				<RefreshCw size={14} class={syncing ? 'animate-spin' : ''} />
				{syncing ? m.crm_syncing() : m.crm_sync_now()}
			</Button>
			<Button variant="primary" size="sm" onclick={newContact} disabled={creating}>
				<Plus size={14} /> {m.crm_new_contact()}
			</Button>
		{/snippet}
	</PageHeader>

	<!-- Filter bar — instant, client-side (no Apply button) -->
	<div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--hairline)]">
		<input
			bind:value={search}
			placeholder={m.crm_search_placeholder()}
			class="h-8 px-3 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)] min-w-[12rem]"
		/>
		<select bind:value={stage} class="h-8 px-2 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]">
			<option value="">{m.crm_all_stages()}</option>
			{#each STAGES as s (s)}<option value={s}>{stageLabel(s)}</option>{/each}
		</select>
		<select bind:value={tagId} class="h-8 px-2 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]">
			<option value="">{m.crm_all_tags()}</option>
			{#each tags as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
		</select>
		<select bind:value={sort} class="h-8 px-2 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]">
			{#each SORTS as s (s.v)}<option value={s.v}>{s.label()}</option>{/each}
		</select>
		<span class="ml-auto t-caption">{m.crm_contact_count({ count: filtered.length })}</span>
	</div>

	<!-- Ranked list -->
	<div class="flex-1 min-h-0 overflow-auto">
		{#if contacts.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 text-center p-8">
				<Contact size={32} class="text-muted-foreground" />
				<p class="t-body">{m.crm_empty_title()}</p>
				<p class="t-caption max-w-sm">{m.crm_empty_body()}</p>
			</div>
		{:else}
			<table class="w-full text-sm border-collapse">
				<thead class="sticky top-0 bg-bg/90 backdrop-blur z-10">
					<tr class="text-left t-caption border-b border-[var(--hairline)]">
						<th class="px-4 py-2 font-medium">{m.crm_col_contact()}</th>
						<th class="px-3 py-2 font-medium w-24">{m.crm_col_score()}</th>
						<th class="px-3 py-2 font-medium">{m.crm_col_stage()}</th>
						<th class="px-3 py-2 font-medium text-right w-28">{m.crm_col_channels()}</th>
						<th class="px-3 py-2 font-medium text-right w-20">{m.crm_col_msgs()}</th>
						<th class="px-4 py-2 font-medium text-right w-28">{m.crm_col_last_contact()}</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as c (c.contact_id)}
						<tr
							class="border-b border-[var(--hairline)] hover:bg-white/[0.03] cursor-pointer transition-colors"
							onclick={() => goto(`/crm/${c.contact_id}`)}
						>
							<td class="px-4 py-2">
								<div class="font-medium truncate max-w-[24rem]" title={contactLabel(c.display_name)}>
									<Highlight text={contactLabel(c.display_name)} query={search} />
								</div>
								{#if c.source === 'manual'}<span class="t-caption">{m.crm_source_manual()}</span>{/if}
							</td>
							<td class="px-3 py-2">
								<ScoreBadge score={c.score} r={c.r_score} f={c.f_score} m={c.m_score} />
							</td>
							<td class="px-3 py-2">
								<StagePill stage={c.stage} overridden={false} />
							</td>
							<td class="px-3 py-2">
								{#if c.channels && c.channels.length > 0}
									<div class="flex items-center justify-end gap-1.5 text-muted-foreground">
										{#each c.channels as ch (ch)}
											<ChannelBrandIcon channel={ch} size={15} />
										{/each}
									</div>
								{:else}
									<div class="text-right text-muted-foreground">—</div>
								{/if}
							</td>
							<td class="px-3 py-2 text-right tabular-nums">{c.inbound_msgs}/{c.total_msgs}</td>
							<td class="px-4 py-2 text-right t-caption">{relativeTime(c.last_contact_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
