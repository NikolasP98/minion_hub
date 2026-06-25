<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { FileText, ArrowUp, ArrowDown, ChevronsUpDown, ExternalLink } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';
	import ColumnFilter from '$lib/components/crm/ColumnFilter.svelte';
	import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';

	let { data }: { data: PageData } = $props();
	const invoices = $derived(data.invoices);

	let search = $state('');
	type SortKey = 'number' | 'issued' | 'client' | 'total';
	let sortKey = $state<SortKey>('issued');
	let sortDir = $state<'asc' | 'desc'>('desc');
	// Filters seed from the URL so the finances dashboard KPIs can deep-link a
	// pre-filtered view (?status=void → voided, ?discounted=1 → discounted).
	const qp = page.url.searchParams;
	let statusFilter = $state<Set<string>>(
		new Set((qp.get('status') ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
	);
	let discountedOnly = $state(qp.get('discounted') === '1');

	type Row = (typeof invoices)[number];

	// Status filter options derived from the loaded set (adapts to whatever the
	// provider emits); label = capitalized raw value, matching the status pill.
	const statusOptions = $derived.by(() => {
		const s = new Set<string>();
		for (const inv of invoices) if (inv.status) s.add(inv.status);
		return [...s].sort().map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
	});

	function setSort(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = key === 'number' || key === 'client' ? 'asc' : 'desc';
		}
	}

	const numOf = (s: string | null) => {
		const n = Number(s);
		return Number.isFinite(n) ? n : -Infinity;
	};
	const dateOf = (d: Date | null) => (d ? new Date(d).getTime() : -Infinity);
	const nameOf = (r: Row) => (r.clientName ?? '￿').toLowerCase();
	const labelOf = (r: Row) => r.number ?? r.documentId ?? '';

	const view = $derived.by(() => {
		const q = search.trim().toLowerCase();
		let list = invoices;
		if (q)
			list = list.filter(
				(inv) =>
					labelOf(inv).toLowerCase().includes(q) ||
					(inv.clientName ?? '').toLowerCase().includes(q) ||
					(inv.clientDocNumber ?? '').toLowerCase().includes(q),
			);
		if (statusFilter.size) list = list.filter((inv) => inv.status != null && statusFilter.has(inv.status));
		if (discountedOnly) list = list.filter((inv) => Number(inv.discount) > 0);

		const byName = (a: Row, b: Row) => (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0);
		const byLabel = (a: Row, b: Row) =>
			labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true });
		const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
			number: byLabel,
			issued: (a, b) => dateOf(a.issuedAt) - dateOf(b.issuedAt),
			client: byName,
			total: (a, b) => numOf(a.total) - numOf(b.total),
		};
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...list].sort((a, b) => dir * cmp[sortKey](a, b) || dir * (dateOf(b.issuedAt) - dateOf(a.issuedAt)));
	});

	// Windowed rendering (same approach as CRM customers): filter/sort over the
	// full set, but only mount the top slice and grow it on scroll.
	const PAGE = 60;
	let renderLimit = $state(PAGE);
	const windowed = $derived(view.slice(0, renderLimit));
	$effect(() => {
		view;
		renderLimit = PAGE;
	});
	function infiniteScroll(root: HTMLElement) {
		const onScroll = () => {
			if (renderLimit >= view.length) return;
			if (root.scrollTop + root.clientHeight >= root.scrollHeight - 600) {
				renderLimit = Math.min(renderLimit + PAGE, view.length);
			}
		};
		root.addEventListener('scroll', onScroll, { passive: true });
		return { destroy: () => root.removeEventListener('scroll', onScroll) };
	}

	function fmtDate(d: Date | null) {
		if (!d) return '—';
		return new Date(d).toLocaleDateString();
	}
	function fmtMoney(v: string | null) {
		if (v == null) return '—';
		return Number(v).toLocaleString();
	}
	// Cross-report nav: jump to the CRM contact this invoice's client maps to.
	// stopPropagation so the row's own navigation (→ invoice detail) doesn't fire.
	function toContact(e: Event, id: string) {
		e.stopPropagation();
		void goto(`/crm/${id}`);
	}
</script>

<svelte:head><title>{m.fin_invoices_title()}</title></svelte:head>

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
	<PageHeader title={m.fin_invoices_title()} subtitle={m.fin_invoices_subtitle()}>
		{#snippet leading()}<FileText size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<!-- Filter bar — instant client-side search/filter over the full set. -->
	<div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--hairline)]">
		<input
			bind:value={search}
			placeholder={m.fin_invoices_search()}
			class="h-8 px-3 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)] min-w-[14rem]"
		/>
		{#if discountedOnly}
			<button class="chip" onclick={() => (discountedOnly = false)}>
				{m.fin_kpi_discount_rate()}
				<span class="chip-x">×</span>
			</button>
		{/if}
		<span class="t-caption">{m.fin_invoices_count({ count: view.length })}</span>
		{#if data.contactName}<ScopeBanner name={data.contactName} contactId={data.contactId} noun="invoices" />{/if}
	</div>

	<div class="flex-1 min-h-0 overflow-auto" use:infiniteScroll>
		{#if invoices.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
				<FileText size={32} class="text-muted-foreground" />
				<p class="t-caption">{m.fin_invoices_empty()}</p>
			</div>
		{:else}
			<table class="w-full text-sm border-collapse">
				<thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
					<tr class="text-left t-caption border-b border-[var(--hairline)]">
						<th class="px-4 py-2 font-medium">{@render sortHead('number', m.fin_col_number())}</th>
						<th class="px-3 py-2 font-medium">{@render sortHead('issued', m.fin_col_issued_at())}</th>
						<th class="px-3 py-2 font-medium">{@render sortHead('client', m.fin_col_client())}</th>
						<th class="px-3 py-2 font-medium">{m.fin_col_dni()}</th>
						<th class="px-3 py-2 font-medium text-right">{@render sortHead('total', m.fin_col_total(), true)}</th>
						<th class="px-4 py-2 font-medium">
							<ColumnFilter label={m.fin_col_status()} options={statusOptions} bind:selected={statusFilter} />
						</th>
					</tr>
				</thead>
				<tbody>
					{#if view.length === 0}
						<tr><td colspan="6" class="px-4 py-8 text-center t-caption text-muted-foreground">{m.fin_invoices_no_match()}</td></tr>
					{/if}
					{#each windowed as inv (inv.id)}
						<tr
							class="border-b border-[var(--hairline)] hover:bg-white/[0.03] cursor-pointer transition-colors"
							onclick={() => goto(`/finances/invoices/${inv.id}`)}
						>
							<td class="px-4 py-2 font-medium">{inv.number ?? inv.documentId ?? '—'}</td>
							<td class="px-3 py-2 t-caption">{fmtDate(inv.issuedAt)}</td>
							<td class="px-3 py-2 max-w-[20rem]">
								{#if inv.crmContactId}
									<button class="link-cell truncate" title={inv.clientName ?? ''} onclick={(e) => toContact(e, inv.crmContactId!)}>
										<span class="truncate">{inv.clientName ?? '—'}</span>
										<ExternalLink size={11} class="link-ico" />
									</button>
								{:else}
									<span class="truncate block">{inv.clientName ?? '—'}</span>
								{/if}
							</td>
							<td class="px-3 py-2 t-caption">
								{#if inv.crmContactId && inv.clientDocNumber}
									<button class="link-cell" onclick={(e) => toContact(e, inv.crmContactId!)}>{inv.clientDocNumber}</button>
								{:else}
									{inv.clientDocNumber ?? '—'}
								{/if}
							</td>
							<td class="px-3 py-2 text-right font-variant-numeric tabular-nums">{fmtMoney(inv.total)}</td>
							<td class="px-4 py-2"><span class="status-pill" data-status={inv.status ?? ''}>{inv.status ?? '—'}</span></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<style>
	.sort-h {
		display: inline-flex; align-items: center; gap: 0.25rem;
		font: inherit; color: inherit; cursor: pointer;
	}
	.sort-h.active { color: var(--color-accent); }
	.chip {
		display: inline-flex; align-items: center; gap: 0.3rem;
		height: 1.6rem; padding: 0 0.5rem;
		font-size: 0.74rem; cursor: pointer;
		border-radius: 999px;
		border: 1px solid var(--color-accent);
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
	.chip-x { font-size: 0.95rem; line-height: 1; opacity: 0.8; }
	:global(.sort-h .dim) { opacity: 0.35; }
	.link-cell {
		display: inline-flex; align-items: center; gap: 0.3rem; max-width: 100%;
		font: inherit; color: inherit; text-align: left; cursor: pointer;
		border-radius: var(--radius-sm, 6px);
	}
	.link-cell:hover { color: var(--color-accent); text-decoration: underline; }
	:global(.link-cell .link-ico) { opacity: 0; flex-shrink: 0; transition: opacity 0.12s; }
	.link-cell:hover :global(.link-ico) { opacity: 0.7; }
	.status-pill {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.74rem;
		font-weight: 500;
		text-transform: capitalize;
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.status-pill[data-status='paid'] {
		background: color-mix(in srgb, var(--color-success, #22c55e) 15%, transparent);
		color: var(--color-success, #22c55e);
	}
	.status-pill[data-status='partial'] {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent);
		color: var(--color-warning, #f59e0b);
	}
	.status-pill[data-status='void'] {
		background: color-mix(in srgb, var(--color-destructive, #ef4444) 12%, transparent);
		color: var(--color-destructive, #ef4444);
	}
</style>
