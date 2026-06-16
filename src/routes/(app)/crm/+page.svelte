<script lang="ts">
	import type { PageData } from './$types';
	import { goto, invalidate } from '$app/navigation';
	import { browser } from '$app/environment';
	import * as m from '$lib/paraglide/messages';
	import { Contact, RefreshCw, Plus, Settings, Wand2, ArrowUp, ArrowDown, ChevronsUpDown, Columns3, Check } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import ScoreCell from '$lib/components/crm/ScoreCell.svelte';
	import StagePill from '$lib/components/crm/StagePill.svelte';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
	import ColumnFilter from '$lib/components/crm/ColumnFilter.svelte';
	import Highlight from '$lib/components/crm/Highlight.svelte';
	import { relativeTime, contactLabel } from '$lib/components/crm/crm-format';
	import { stageLabel } from '$lib/components/crm/crm-i18n';
	import { collectMetaKeys, metaLabel, metaDisplay } from '$lib/components/crm/crm-meta';

	let { data }: { data: PageData } = $props();
	const contacts = $derived(data.contacts);
	const tags = $derived(data.tags);

	// ── Column editor (custom-field metadata columns) ──────────────────────────
	// The roster carries each contact's jsonb metadata; the viewer chooses which
	// keys become table columns. Selection persists per-org in localStorage.
	const metaKeys = $derived(collectMetaKeys(contacts));
	const colStorageKey = $derived(`crm:cols:${data.orgId ?? 'default'}`);
	let metaCols = $state<string[]>([]);
	let colMenuOpen = $state(false);

	// Load persisted column selection once we know the org (client only).
	$effect(() => {
		if (!browser) return;
		const raw = localStorage.getItem(colStorageKey);
		const saved: string[] = raw ? (JSON.parse(raw) as string[]) : [];
		// Drop saved keys no longer present in the data.
		metaCols = saved.filter((k) => metaKeys.includes(k));
	});

	function toggleCol(key: string) {
		metaCols = metaCols.includes(key) ? metaCols.filter((k) => k !== key) : [...metaCols, key];
		if (browser) localStorage.setItem(colStorageKey, JSON.stringify(metaCols));
	}

	let search = $state('');
	let tagId = $state('');
	type SortKey = 'name' | 'score' | 'frequency' | 'recent';
	let sortKey = $state<SortKey>('score');
	let sortDir = $state<'asc' | 'desc'>('desc');
	let stageFilter = $state<Set<string>>(new Set());
	let channelFilter = $state<Set<string>>(new Set());

	let syncing = $state(false);
	let creating = $state(false);

	const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
	const stageOptions = STAGES.map((s) => ({ value: s, label: stageLabel(s) }));
	const channelOptions = $derived.by(() => {
		const s = new Set<string>();
		for (const c of contacts) for (const ch of c.channels ?? []) s.add(ch);
		return [...s].sort().map((ch) => ({ value: ch, label: ch.charAt(0).toUpperCase() + ch.slice(1) }));
	});

	function setSort(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = key === 'name' ? 'asc' : 'desc';
		}
	}

	const view = $derived.by(() => {
		const q = search.trim().toLowerCase();
		let list = contacts;
		if (q) list = list.filter((c) => (c.display_name ?? '').toLowerCase().includes(q));
		if (tagId) list = list.filter((c) => c.tag_ids?.includes(tagId) || c.auto_tag_ids?.includes(tagId));
		if (stageFilter.size) list = list.filter((c) => stageFilter.has(c.stage));
		if (channelFilter.size) list = list.filter((c) => c.channels?.some((ch) => channelFilter.has(ch)));

		const name = (c: (typeof contacts)[number]) => (c.display_name ?? '￿').toLowerCase();
		const byName = (a: (typeof contacts)[number], b: (typeof contacts)[number]) =>
			name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0;
		const t = (c: (typeof contacts)[number]) => (c.last_contact_at ? Date.parse(c.last_contact_at) : -Infinity);
		const cmp: Record<SortKey, (a: (typeof contacts)[number], b: (typeof contacts)[number]) => number> = {
			name: byName,
			score: (a, b) => a.score - b.score,
			frequency: (a, b) => a.total_msgs - b.total_msgs,
			recent: (a, b) => t(a) - t(b),
		};
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...list].sort((a, b) => dir * cmp[sortKey](a, b) || byName(a, b));
	});

	// ── Windowed rendering ──────────────────────────────────────────────────────
	// At ~1.6k contacts, painting every row at once builds an 8 MB DOM (thousands
	// of icon SVGs) and costs ~3 s on each visit. Filtering/sorting still run over
	// the FULL `view` (UX unchanged — instant, complete results); we only cap how
	// many top rows are mounted, growing the window as the user scrolls. Any change
	// to the filter/sort result resets the window to the top.
	const PAGE = 60;
	let renderLimit = $state(PAGE);
	const windowed = $derived(view.slice(0, renderLimit));
	// Reset to the top whenever the filtered/sorted set changes (new search, tag,
	// stage, channel, or sort). Reading `view` (not `renderLimit`) avoids a loop.
	$effect(() => {
		view;
		renderLimit = PAGE;
	});
	// Grow the window when the sentinel near the list bottom scrolls into view.
	function infiniteScroll(node: HTMLElement) {
		const root = node.closest('[data-scroll-root]') as Element | null;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && renderLimit < view.length) {
					renderLimit = Math.min(renderLimit + PAGE, view.length);
				}
			},
			{ root, rootMargin: '600px 0px' },
		);
		io.observe(node);
		return { destroy: () => io.disconnect() };
	}

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

{#snippet sortHead(key: SortKey, label: string, alignRight = false)}
	<button class="sort-h {alignRight ? 'justify-end w-full' : ''}" class:active={sortKey === key} onclick={() => setSort(key)}>
		<span>{label}</span>
		{#if sortKey === key}
			{#if sortDir === 'asc'}<ArrowUp size={12} />{:else}<ArrowDown size={12} />{/if}
		{:else}
			<ChevronsUpDown size={11} class="dim" />
		{/if}
	</button>
{/snippet}

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.crm_title()} subtitle={m.crm_subtitle()}>
		{#snippet leading()}
			<Contact size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>

	<!-- Filter + actions bar — instant, client-side filtering; actions live here
	     (not in the header) so they don't collide with the floating profile notch. -->
	<div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--hairline)]">
		<input
			bind:value={search}
			placeholder={m.crm_search_placeholder()}
			class="h-8 px-3 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)] min-w-[12rem]"
		/>
		<select bind:value={tagId} class="h-8 px-2 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]">
			<option value="">{m.crm_all_tags()}</option>
			{#each tags as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
		</select>
		<span class="t-caption">{m.crm_contact_count({ count: view.length })}</span>

		<div class="ml-auto flex items-center gap-2">
			{#if metaKeys.length > 0}
				<div class="col-wrap">
					<button class="p-1.5 rounded hover:bg-white/[0.06] inline-flex" class:active-col={metaCols.length > 0} aria-label={m.crm_columns()} title={m.crm_columns()} onclick={() => (colMenuOpen = !colMenuOpen)}>
						<Columns3 size={16} />
					</button>
					{#if colMenuOpen}
						<button class="backdrop" aria-label="close" onclick={() => (colMenuOpen = false)}></button>
						<div class="col-menu">
							<div class="col-menu-h">{m.crm_columns_heading()}</div>
							{#each metaKeys as key (key)}
								<button class="col-item" onclick={() => toggleCol(key)}>
									<span class="col-check" class:on={metaCols.includes(key)}>{#if metaCols.includes(key)}<Check size={12} />{/if}</span>
									<span class="col-label">{metaLabel(key)}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
			<a href="/crm/cleanup" class="p-1.5 rounded hover:bg-white/[0.06] inline-flex" aria-label={m.crm_hygiene_title()} title={m.crm_hygiene_nav()}>
				<Wand2 size={16} />
			</a>
			<a href="/crm/settings" class="p-1.5 rounded hover:bg-white/[0.06] inline-flex" aria-label={m.crm_settings_title()} title={m.crm_settings_title()}>
				<Settings size={16} />
			</a>
			<Button variant="outline" size="sm" onclick={syncNow} disabled={syncing}>
				<RefreshCw size={14} class={syncing ? 'animate-spin' : ''} />
				{syncing ? m.crm_syncing() : m.crm_sync_now()}
			</Button>
			<Button variant="primary" size="sm" onclick={newContact} disabled={creating}>
				<Plus size={14} /> {m.crm_new_contact()}
			</Button>
		</div>
	</div>

	<!-- Ranked list -->
	<div class="flex-1 min-h-0 overflow-auto" data-scroll-root>
		{#if contacts.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 text-center p-8">
				<Contact size={32} class="text-muted-foreground" />
				<p class="t-body">{m.crm_empty_title()}</p>
				<p class="t-caption max-w-sm">{m.crm_empty_body()}</p>
			</div>
		{:else}
			<table class="w-full text-sm border-collapse">
				<thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
					<tr class="text-left t-caption border-b border-[var(--hairline)]">
						<th class="px-4 py-2 font-medium">{@render sortHead('name', m.crm_col_contact())}</th>
						<th class="px-3 py-2 font-medium w-28">{@render sortHead('score', m.crm_col_score())}</th>
						<th class="px-3 py-2 font-medium">
							<ColumnFilter label={m.crm_col_stage()} options={stageOptions} bind:selected={stageFilter} />
						</th>
						{#each metaCols as key (key)}
							<th class="px-3 py-2 font-medium meta-col">{metaLabel(key)}</th>
						{/each}
						<th class="px-3 py-2 font-medium text-right w-28">
							<div class="flex justify-end">
								<ColumnFilter label={m.crm_col_channels()} options={channelOptions} bind:selected={channelFilter} align="right">
									{#snippet optionIcon(v)}<ChannelBrandIcon channel={v} size={14} />{/snippet}
								</ColumnFilter>
							</div>
						</th>
						<th class="px-3 py-2 font-medium text-right w-24">{@render sortHead('frequency', m.crm_col_msgs(), true)}</th>
						<th class="px-4 py-2 font-medium text-right w-28">{@render sortHead('recent', m.crm_col_last_contact(), true)}</th>
					</tr>
				</thead>
				<tbody>
					{#each windowed as c (c.contact_id)}
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
							<td class="px-3 py-2"><ScoreCell score={c.score} r={c.r_score} f={c.f_score} m={c.m_score} /></td>
							<td class="px-3 py-2"><StagePill stage={c.stage} overridden={false} /></td>
							{#each metaCols as key (key)}
								<td class="px-3 py-2 meta-cell" title={metaDisplay(key, c.custom_fields?.[key])}>{metaDisplay(key, c.custom_fields?.[key])}</td>
							{/each}
							<td class="px-3 py-2">
								{#if c.channels && c.channels.length > 0}
									<div class="flex items-center justify-end gap-1.5 text-muted-foreground">
										{#each c.channels as ch (ch)}<ChannelBrandIcon channel={ch} size={15} />{/each}
									</div>
								{:else}
									<div class="text-right text-muted-foreground">—</div>
								{/if}
							</td>
							<td class="px-3 py-2">
								<div class="msgs">
									<span class="m-in" title={m.crm_inbound_value({ count: c.inbound_msgs })}><ArrowDown size={11} />{c.inbound_msgs}</span>
									<span class="m-out" title={m.crm_outbound_value({ count: c.total_msgs - c.inbound_msgs })}><ArrowUp size={11} />{c.total_msgs - c.inbound_msgs}</span>
								</div>
							</td>
							<td class="px-4 py-2 text-right t-caption">{relativeTime(c.last_contact_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if renderLimit < view.length}
				<div use:infiniteScroll class="h-1" aria-hidden="true"></div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.sort-h {
		display: inline-flex; align-items: center; gap: 0.25rem;
		font: inherit; color: inherit; cursor: pointer;
	}
	.sort-h.active { color: var(--color-accent); }
	:global(.sort-h .dim) { opacity: 0.35; }
	.msgs { display: flex; align-items: center; justify-content: flex-end; gap: 0.6rem; font-variant-numeric: tabular-nums; }
	.m-in { display: inline-flex; align-items: center; gap: 0.1rem; color: var(--color-emerald, var(--color-success)); }
	.m-out { display: inline-flex; align-items: center; gap: 0.1rem; color: var(--color-muted-foreground); }

	/* column editor */
	.col-wrap { position: relative; display: inline-flex; }
	.active-col { color: var(--color-accent); }
	.backdrop { position: fixed; inset: 0; z-index: 40; background: transparent; }
	.col-menu {
		position: absolute; top: calc(100% + 4px); right: 0; z-index: 41; min-width: 12rem; max-height: 20rem; overflow: auto;
		background: var(--color-card); border: 1px solid var(--hairline); border-radius: var(--radius-md);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); padding: 0.3rem;
	}
	.col-menu-h { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); padding: 0.3rem 0.4rem; }
	.col-item { display: flex; align-items: center; gap: 0.5rem; width: 100%; padding: 0.35rem 0.4rem; border-radius: var(--radius-sm, 6px); text-align: left; }
	.col-item:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
	.col-check { display: grid; place-items: center; width: 1rem; height: 1rem; border-radius: 4px; border: 1px solid var(--hairline); flex-shrink: 0; }
	.col-check.on { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-bg, #000); }
	.col-label { font-size: 0.84rem; text-transform: capitalize; }
	.meta-col { font-weight: 500; text-transform: capitalize; white-space: nowrap; }
	.meta-cell { max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-muted-foreground); }
</style>
