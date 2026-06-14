<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ChevronDown } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	type Option = { value: string; label: string };
	let {
		label,
		options,
		selected = $bindable(),
		align = 'left',
		optionIcon,
	}: {
		label: string;
		options: Option[];
		/** Empty set = "All". Non-empty = only those values. */
		selected: Set<string>;
		align?: 'left' | 'right';
		optionIcon?: Snippet<[string]>;
	} = $props();

	let open = $state(false);
	const active = $derived(selected.size > 0);

	function toggle(v: string) {
		const next = new Set(selected);
		if (next.has(v)) next.delete(v);
		else next.add(v);
		selected = next;
	}
	function clearAll() {
		selected = new Set();
	}
</script>

<div class="cf">
	<button class="head" class:active onclick={() => (open = !open)}>
		<span>{label}</span>
		{#if active}<span class="badge">{selected.size}</span>{/if}
		<ChevronDown size={12} class="chev {open ? 'flip' : ''}" />
	</button>

	{#if open}
		<!-- backdrop closes on outside click -->
		<button class="backdrop" aria-label="close" onclick={() => (open = false)}></button>
		<div class="pop" class:right={align === 'right'}>
			<button class="row" class:sel={!active} onclick={clearAll}>
				<span class="box" class:on={!active}></span>
				<span class="lbl">{m.crm_filter_all()}</span>
			</button>
			<div class="sep"></div>
			{#each options as o (o.value)}
				<button class="row" class:sel={selected.has(o.value)} onclick={() => toggle(o.value)}>
					<span class="box" class:on={selected.has(o.value)}></span>
					{#if optionIcon}{@render optionIcon(o.value)}{/if}
					<span class="lbl">{o.label}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.cf { position: relative; display: inline-flex; }
	.head {
		display: inline-flex; align-items: center; gap: 0.25rem;
		font: inherit; color: inherit; cursor: pointer;
	}
	.head.active { color: var(--color-accent); }
	.badge {
		font-size: 0.6rem; min-width: 1rem; height: 1rem; padding: 0 0.2rem; border-radius: 999px;
		background: var(--color-accent); color: var(--color-accent-foreground);
		display: inline-flex; align-items: center; justify-content: center;
	}
	:global(.cf .chev) { transition: transform 0.12s; opacity: 0.6; }
	:global(.cf .chev.flip) { transform: rotate(180deg); }
	.backdrop { position: fixed; inset: 0; z-index: 40; background: transparent; cursor: default; }
	.pop {
		position: absolute; top: calc(100% + 4px); left: 0; z-index: 41;
		min-width: 11rem; max-height: 16rem; overflow: auto;
		background: var(--color-card); border: 1px solid var(--hairline);
		border-radius: var(--radius-md); box-shadow: 0 8px 28px rgba(0,0,0,0.35); padding: 0.25rem;
	}
	.pop.right { left: auto; right: 0; }
	.row {
		display: flex; align-items: center; gap: 0.45rem; width: 100%;
		padding: 0.3rem 0.45rem; border-radius: var(--radius-sm, 6px);
		font-size: 0.8rem; font-weight: 400; text-transform: none; letter-spacing: normal;
		color: var(--color-foreground); cursor: pointer; text-align: left;
	}
	.row:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
	.box {
		width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0;
		border: 1.5px solid var(--color-muted-foreground);
	}
	.box.on { background: var(--color-accent); border-color: var(--color-accent); }
	.lbl { flex: 1; }
	.sep { height: 1px; background: var(--hairline); margin: 0.2rem 0; }
</style>
