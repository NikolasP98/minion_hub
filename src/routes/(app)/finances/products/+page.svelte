<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { Package, RefreshCw } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();
	const products = $derived(data.products);
	const coverage = $derived(data.coverage);

	// ── Inline edit state ────────────────────────────────────────────────────
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editCategory = $state('');
	let editUnitPrice = $state('');
	let editBusy = $state(false);
	let editMsg = $state<{ ok: boolean; text: string } | null>(null);

	function startEdit(p: { id: string; name: string; category: string | null; unitPrice: number | null }) {
		editingId = p.id;
		editName = p.name;
		editCategory = p.category ?? '';
		editUnitPrice = p.unitPrice != null ? String(p.unitPrice) : '';
		editMsg = null;
	}

	function cancelEdit() {
		editingId = null;
		editMsg = null;
	}

	async function saveEdit(p: { code: string; active: boolean }) {
		editBusy = true;
		editMsg = null;
		try {
			const res = await fetch('/api/finances/products', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					code: p.code,
					name: editName,
					category: editCategory || null,
					unitPrice: editUnitPrice !== '' ? Number(editUnitPrice) : null,
					active: p.active,
				}),
			});
			if (res.ok) {
				editingId = null;
				await invalidate('finances:data');
			} else {
				editMsg = { ok: false, text: 'Save failed' };
			}
		} catch {
			editMsg = { ok: false, text: 'Save failed' };
		} finally {
			editBusy = false;
		}
	}

	// ── Import from billing ──────────────────────────────────────────────────
	let importBusy = $state(false);
	let importMsg = $state<{ ok: boolean; text: string } | null>(null);

	async function runImport() {
		importBusy = true;
		importMsg = null;
		try {
			const res = await fetch('/api/finances/products/import', { method: 'POST' });
			if (res.ok) {
				const d = await res.json() as { created: number; linked: number };
				importMsg = { ok: true, text: `Imported ${d.created} products, linked ${d.linked} items` };
				await invalidate('finances:data');
			} else {
				importMsg = { ok: false, text: 'Import failed' };
			}
		} catch {
			importMsg = { ok: false, text: 'Import failed' };
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
			<Button variant="outline" size="sm" onclick={runImport} disabled={importBusy}>
				<RefreshCw size={13} class={importBusy ? 'animate-spin' : ''} />
				{m.fin_products_import()}
			</Button>
		{/snippet}
	</PageHeader>

	{#if coverage.billedNotInCatalog > 0}
		<div class="coverage-banner">
			<span>{m.fin_products_coverage({ n: coverage.billedNotInCatalog })}</span>
			<button class="coverage-btn" onclick={runImport} disabled={importBusy}>
				{m.fin_products_import()}
			</button>
		</div>
	{/if}

	{#if importMsg}
		<p class={importMsg.ok ? 'ok-msg px-4' : 'err-msg px-4'}>{importMsg.text}</p>
	{/if}

	<div class="flex-1 min-h-0 overflow-auto">
		{#if products.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
				<Package size={32} class="text-muted-foreground" />
				<p class="t-caption">{m.fin_products_empty()}</p>
				<Button variant="outline" size="sm" onclick={runImport} disabled={importBusy}>
					{m.fin_products_import()}
				</Button>
			</div>
		{:else}
			<table class="w-full text-sm border-collapse">
				<thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
					<tr class="text-left t-caption border-b border-[var(--hairline)]">
						<th class="px-4 py-2 font-medium">{m.fin_col_code()}</th>
						<th class="px-3 py-2 font-medium">{m.fin_col_name()}</th>
						<th class="px-3 py-2 font-medium">{m.fin_col_category()}</th>
						<th class="px-3 py-2 font-medium text-right">{m.fin_col_ref_price()}</th>
						<th class="px-3 py-2 font-medium text-center">{m.fin_col_active()}</th>
						<th class="px-3 py-2 font-medium text-right">{m.fin_col_billed()}</th>
						<th class="px-4 py-2 font-medium text-right">{m.fin_col_revenue()}</th>
						<th class="px-3 py-2 font-medium"></th>
					</tr>
				</thead>
				<tbody>
					{#each products as p (p.id)}
						{@const editing = editingId === p.id}
						<tr class="border-b border-[var(--hairline)] hover:bg-white/[0.03] transition-colors">
							<td class="px-4 py-2 font-mono text-xs">{p.code}</td>
							<td class="px-3 py-2 max-w-[16rem]">
								{#if editing}
									<input class="inp w-full" bind:value={editName} />
								{:else}
									<span class="truncate block">{p.name}</span>
								{/if}
							</td>
							<td class="px-3 py-2 t-caption">
								{#if editing}
									<input class="inp w-full" bind:value={editCategory} />
								{:else}
									{p.category ?? '—'}
								{/if}
							</td>
							<td class="px-3 py-2 text-right tabular-nums">
								{#if editing}
									<input class="inp w-24 text-right" type="number" min="0" step="0.01" bind:value={editUnitPrice} />
								{:else}
									{p.unitPrice != null ? Number(p.unitPrice).toLocaleString() : '—'}
								{/if}
							</td>
							<td class="px-3 py-2 text-center">
								<span class={p.active ? 'badge-active' : 'badge-inactive'}>
									{p.active ? '✓' : '✗'}
								</span>
							</td>
							<td class="px-3 py-2 text-right tabular-nums">{p.billed}</td>
							<td class="px-4 py-2 text-right tabular-nums font-medium">{Number(p.revenue).toLocaleString()}</td>
							<td class="px-3 py-2">
								{#if editing}
									<div class="flex gap-1 justify-end">
										<button class="act-btn act-save" onclick={() => saveEdit(p)} disabled={editBusy}>✓</button>
										<button class="act-btn act-cancel" onclick={cancelEdit}>✗</button>
									</div>
									{#if editMsg}
										<p class="err-msg text-xs">{editMsg.text}</p>
									{/if}
								{:else}
									<button class="act-btn act-edit" onclick={() => startEdit(p)}>✎</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<style>
	.inp {
		height: 1.75rem;
		padding: 0 0.5rem;
		font-size: 0.82rem;
		border-radius: var(--radius-sm);
		background: var(--color-bg3);
		border: 1px solid var(--hairline);
		color: var(--color-foreground);
	}
	.badge-active {
		display: inline-block;
		font-size: 0.75rem;
		color: var(--color-success, var(--color-emerald));
	}
	.badge-inactive {
		display: inline-block;
		font-size: 0.75rem;
		color: var(--color-muted-foreground);
	}
	.act-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.78rem;
		border: 1px solid var(--hairline);
		background: transparent;
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
	}
	.act-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-foreground);
	}
	.act-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.act-save { color: var(--color-accent); }
	.act-cancel { color: var(--color-muted-foreground); }
	.act-edit { opacity: 0.6; }
	.coverage-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		border-bottom: 1px solid var(--hairline);
		font-size: 0.82rem;
		color: var(--color-muted-foreground);
	}
	.coverage-btn {
		font-size: 0.78rem;
		color: var(--color-accent);
		background: transparent;
		border: none;
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
	}
	.coverage-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.ok-msg {
		font-size: 0.8rem;
		color: var(--color-success, var(--color-emerald));
		padding-top: 0.25rem;
		padding-bottom: 0.25rem;
	}
	.err-msg {
		font-size: 0.8rem;
		color: var(--color-destructive);
		padding-top: 0.25rem;
		padding-bottom: 0.25rem;
	}
</style>
