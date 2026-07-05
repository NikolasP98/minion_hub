<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { Package, RefreshCw } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import DataTable from '$lib/components/data-table/DataTable.svelte';
	import type { DataColumn, EditDraft } from '$lib/components/data-table/DataTable.svelte';
	import { canAct } from '$lib/access/can.svelte';

	let { data }: { data: PageData } = $props();
	const products = $derived(data.products);
	const coverage = $derived(data.coverage);

	type Row = (typeof products)[number];

	async function saveRow(p: Row, draft: EditDraft): Promise<boolean> {
		const res = await fetch('/api/finances/products', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				code: p.code,
				name: draft.name,
				category: draft.category || null,
				unitPrice: draft.unitPrice !== '' ? Number(draft.unitPrice) : null,
				active: p.active,
			}),
		});
		if (res.ok) await invalidate('finances:data');
		return res.ok;
	}

	const columns: DataColumn<Row>[] = [
		{ key: 'code', label: m.fin_col_code(), accessor: (p) => p.code, cellClass: 'font-mono text-xs' },
		{ key: 'name', label: m.fin_col_name(), accessor: (p) => p.name, editable: true, custom: true },
		{ key: 'category', label: m.fin_col_category(), accessor: (p) => p.category ?? '', editable: true },
		{
			key: 'unitPrice', label: m.fin_col_ref_price(), align: 'right', editable: true, editType: 'number', custom: true,
			accessor: (p) => p.unitPrice, exportValue: (p) => p.unitPrice ?? '',
		},
		{ key: 'active', label: m.fin_col_active(), align: 'center', custom: true, accessor: (p) => p.active, exportValue: (p) => (p.active ? 1 : 0) },
		{ key: 'billed', label: m.fin_col_billed(), align: 'right', accessor: (p) => p.billed },
		{ key: 'revenue', label: m.fin_col_revenue(), align: 'right', custom: true, accessor: (p) => p.revenue, exportValue: (p) => Number(p.revenue) },
	];

	// ── Import from billing ──────────────────────────────────────────────────
	let importBusy = $state(false);
	let importMsg = $state<{ ok: boolean; text: string } | null>(null);

	async function runImport() {
		importBusy = true;
		importMsg = null;
		try {
			const res = await fetch('/api/finances/products/import', { method: 'POST' });
			if (res.ok) {
				const d = (await res.json()) as { created: number; linked: number };
				importMsg = { ok: true, text: m.fin_products_import_done({ created: d.created, items: d.linked }) };
				await invalidate('finances:data');
			} else {
				importMsg = { ok: false, text: m.fin_products_import_failed() };
			}
		} catch {
			importMsg = { ok: false, text: m.fin_products_import_failed() };
		} finally {
			importBusy = false;
		}
	}
</script>

<svelte:head><title>{m.fin_products_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.fin_products_title()} subtitle={m.fin_products_subtitle()}>
		{#snippet leading()}<Package size={16} class="text-accent shrink-0" />{/snippet}
		{#snippet actions()}
			<Button
				variant="outline"
				size="sm"
				onclick={runImport}
				disabled={importBusy || !canAct('finance', 'edit')}
				title={canAct('finance', 'edit') ? undefined : m.no_permission()}
			>
				<RefreshCw size={13} class={importBusy ? 'animate-spin' : ''} />
				{m.fin_products_import()}
			</Button>
		{/snippet}
	</PageHeader>

	{#if coverage.billedNotInCatalog > 0}
		<div class="coverage-banner">
			<span>{m.fin_products_coverage({ n: coverage.billedNotInCatalog })}</span>
			<button
				class="coverage-btn"
				onclick={runImport}
				disabled={importBusy || !canAct('finance', 'edit')}
				title={canAct('finance', 'edit') ? undefined : m.no_permission()}
			>
				{m.fin_products_import()}
			</button>
		</div>
	{/if}

	{#if importMsg}
		<p class={importMsg.ok ? 'ok-msg px-4' : 'err-msg px-4'}>{importMsg.text}</p>
	{/if}

	<DataTable
		class="flex-1 min-h-0"
		{columns}
		data={products}
		getRowId={(p) => p.id}
		searchPlaceholder={m.data_table_search()}
		exportable
		exportName="products"
		storageKey="finances-products"
		canEdit={canAct('finance', 'edit')}
		onSaveRow={saveRow}
		emptyMessage={m.fin_products_empty()}
	>
		{#snippet cell(p: Row, col: DataColumn<Row>)}
			{#if col.key === 'name'}
				<span class="truncate block max-w-[16rem]">{p.name}</span>
			{:else if col.key === 'unitPrice'}
				<span class="tabular-nums">{p.unitPrice != null ? Number(p.unitPrice).toLocaleString() : '—'}</span>
			{:else if col.key === 'active'}
				<span class={p.active ? 'badge-active' : 'badge-inactive'}>{p.active ? '✓' : '✗'}</span>
			{:else if col.key === 'revenue'}
				<span class="tabular-nums font-medium">{Number(p.revenue).toLocaleString()}</span>
			{/if}
		{/snippet}
	</DataTable>
</div>

<style>
	.badge-active { display: inline-block; font-size: 0.75rem; color: var(--color-success, var(--color-emerald)); }
	.badge-inactive { display: inline-block; font-size: 0.75rem; color: var(--color-muted-foreground); }
	.coverage-banner {
		display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 1rem;
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		border-bottom: 1px solid var(--hairline); font-size: 0.82rem; color: var(--color-muted-foreground);
	}
	.coverage-btn { font-size: 0.78rem; color: var(--color-accent); background: transparent; border: none; cursor: pointer; text-decoration: underline; padding: 0; }
	.coverage-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.ok-msg { font-size: 0.8rem; color: var(--color-success, var(--color-emerald)); padding-top: 0.25rem; padding-bottom: 0.25rem; }
	.err-msg { font-size: 0.8rem; color: var(--color-destructive); padding-top: 0.25rem; padding-bottom: 0.25rem; }
</style>
