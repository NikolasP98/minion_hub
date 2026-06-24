<script lang="ts">
	import { X, FileText, Sheet, Check } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui';

	type Col = { key: string; label: string; default: boolean };
	let {
		open = $bindable(),
		columns,
		count,
		onexport,
	}: {
		open: boolean;
		columns: Col[];
		count: number;
		onexport: (format: 'csv' | 'xlsx', keys: string[]) => void;
	} = $props();

	let format = $state<'csv' | 'xlsx'>('csv');
	let selected = $state<Set<string>>(new Set());

	// Reset the column selection to the current defaults each time the dialog opens.
	$effect(() => {
		if (open) selected = new Set(columns.filter((c) => c.default).map((c) => c.key));
	});

	function toggle(key: string) {
		const next = new Set(selected);
		next.has(key) ? next.delete(key) : next.add(key);
		selected = next;
	}
	function run() {
		// Preserve registry order; never export an empty column set.
		const keys = columns.filter((c) => selected.has(c.key)).map((c) => c.key);
		if (keys.length === 0) return;
		onexport(format, keys);
		open = false;
	}
</script>

{#if open}
	<button class="ovl" aria-label="close" onclick={() => (open = false)}></button>
	<div class="dlg" role="dialog" aria-modal="true" aria-label={m.crm_export_title()}>
		<header class="dlg-h">
			<span>{m.crm_export_title()}</span>
			<button class="x" aria-label={m.crm_export_cancel()} onclick={() => (open = false)}><X size={16} /></button>
		</header>

		<div class="dlg-body">
			<div class="seg-label">{m.crm_export_format()}</div>
			<div class="fmt">
				<button class="fmt-btn" class:on={format === 'csv'} onclick={() => (format = 'csv')}>
					<FileText size={15} /> CSV
				</button>
				<button class="fmt-btn" class:on={format === 'xlsx'} onclick={() => (format = 'xlsx')}>
					<Sheet size={15} /> XLSX
				</button>
			</div>

			<div class="seg-label flex items-center justify-between">
				<span>{m.crm_export_columns()}</span>
				<span class="t-caption">{m.crm_export_selected({ n: selected.size, total: columns.length })}</span>
			</div>
			<div class="cols">
				{#each columns as c (c.key)}
					<button class="col" onclick={() => toggle(c.key)}>
						<span class="cbx" class:on={selected.has(c.key)}>{#if selected.has(c.key)}<Check size={12} />{/if}</span>
						<span class="col-label">{c.label}</span>
					</button>
				{/each}
			</div>
		</div>

		<footer class="dlg-f">
			<Button variant="outline" size="sm" onclick={() => (open = false)}>{m.crm_export_cancel()}</Button>
			<Button variant="primary" size="sm" onclick={run} disabled={selected.size === 0}>
				{m.crm_export_download({ count })}
			</Button>
		</footer>
	</div>
{/if}

<style>
	.ovl { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, 0.5); }
	.dlg {
		position: fixed; z-index: 61; top: 50%; left: 50%; transform: translate(-50%, -50%);
		width: min(28rem, calc(100vw - 2rem)); max-height: min(80vh, 40rem);
		display: flex; flex-direction: column;
		background: var(--color-card); border: 1px solid var(--hairline);
		border-radius: var(--radius-lg); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}
	.dlg-h {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.85rem 1rem; border-bottom: 1px solid var(--hairline);
		font-weight: 600; font-size: 0.9rem;
	}
	.x { display: inline-flex; color: var(--color-muted-foreground); }
	.x:hover { color: var(--color-foreground); }
	.dlg-body { padding: 0.85rem 1rem; overflow: auto; }
	.seg-label {
		font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em;
		color: var(--color-muted-foreground); margin: 0.4rem 0 0.5rem;
	}
	.fmt { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
	.fmt-btn {
		flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
		height: 2.2rem; border-radius: var(--radius-md); border: 1px solid var(--hairline);
		font-size: 0.82rem; font-weight: 600; color: var(--color-muted-foreground); background: var(--color-bg3);
		transition: color var(--duration-fast) var(--ease-standard);
	}
	.fmt-btn:hover { color: var(--color-foreground); }
	.fmt-btn.on { color: var(--color-accent); border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
	.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0.15rem; }
	.col { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.4rem; border-radius: var(--radius-sm, 6px); text-align: left; }
	.col:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
	.cbx { display: grid; place-items: center; width: 1rem; height: 1rem; border-radius: 4px; border: 1px solid var(--hairline); flex-shrink: 0; }
	.cbx.on { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-bg, #000); }
	.col-label { font-size: 0.82rem; }
	.dlg-f { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1rem; border-top: 1px solid var(--hairline); }
</style>
