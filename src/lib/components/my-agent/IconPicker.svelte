<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Search, Smile, Shapes, X } from 'lucide-svelte';
	import { EMOJI_SET, ICON_SET } from './note-icons';

	let {
		onpick,
		onclose,
		current = ''
	}: { onpick: (value: string) => void; onclose: () => void; current?: string } = $props();

	let tab = $state<'emoji' | 'icons'>('emoji');
	let query = $state('');

	const q = $derived(query.trim().toLowerCase());
	const emojis = $derived(q ? EMOJI_SET.filter((e) => e.keywords.includes(q) || e.char.includes(q)) : EMOJI_SET);
	const icons = $derived(
		q ? ICON_SET.filter((e) => e.keywords.includes(q) || e.name.toLowerCase().includes(q)) : ICON_SET
	);

	function pick(value: string) {
		onpick(value);
		onclose();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ip" onmousedown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-label={m.iconPicker_pickIcon()}>
	<div class="ip-head">
		<div class="ip-tabs" role="tablist">
			<button type="button" role="tab" class="ip-tab" class:on={tab === 'emoji'} aria-selected={tab === 'emoji'} onclick={() => (tab = 'emoji')}>
				<Smile size={14} /> {m.iconPicker_emoji()}
			</button>
			<button type="button" role="tab" class="ip-tab" class:on={tab === 'icons'} aria-selected={tab === 'icons'} onclick={() => (tab = 'icons')}>
				<Shapes size={14} /> {m.iconPicker_icons()}
			</button>
		</div>
		<button type="button" class="ip-close" title={m.common_close()} aria-label={m.common_close()} onclick={onclose}><X size={14} /></button>
	</div>

	<div class="ip-search">
		<Search size={13} />
		<!-- svelte-ignore a11y_autofocus -->
		<input type="text" placeholder={m.iconPicker_search()} bind:value={query} aria-label={m.iconPicker_searchIcons()} autofocus />
		{#if current}
			<button type="button" class="ip-clear" onclick={() => pick('')}>{m.iconPicker_remove()}</button>
		{/if}
	</div>

	<div class="ip-grid" role="listbox">
		{#if tab === 'emoji'}
			{#each emojis as e (e.char)}
				<button type="button" class="ip-cell emoji" class:sel={current === e.char} title={e.keywords} onclick={() => pick(e.char)}>{e.char}</button>
			{/each}
			{#if emojis.length === 0}<p class="ip-empty">{m.common_noMatches()}</p>{/if}
		{:else}
			{#each icons as ic (ic.name)}
				{@const Comp = ic.comp}
				<button type="button" class="ip-cell" class:sel={current === `lucide:${ic.name}`} title={ic.name} onclick={() => pick(`lucide:${ic.name}`)}>
					<Comp size={18} />
				</button>
			{/each}
			{#if icons.length === 0}<p class="ip-empty">{m.common_noMatches()}</p>{/if}
		{/if}
	</div>
</div>

<style>
	.ip {
		width: 280px;
		max-width: 88vw;
		display: flex;
		flex-direction: column;
		border-radius: 12px;
		background: var(--color-bg2, #1b1b1f);
		border: 1px solid var(--color-border);
		box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6);
		overflow: hidden;
	}
	.ip-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 8px 4px;
	}
	.ip-tabs {
		display: flex;
		gap: 2px;
	}
	.ip-tab {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font-size: 12px;
		font-family: inherit;
		border-radius: 7px;
		cursor: pointer;
		color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
		background: transparent;
		border: none;
		transition: color 120ms ease, background 120ms ease;
	}
	.ip-tab:hover {
		color: var(--color-foreground);
	}
	.ip-tab.on {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
	}
	.ip-close {
		display: inline-flex;
		padding: 5px;
		border-radius: 6px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
	}
	.ip-close:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
	}
	.ip-search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 4px 10px 8px;
		padding: 7px 10px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
	}
	.ip-search input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		font-family: inherit;
		font-size: 12.5px;
		color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
	}
	.ip-clear {
		font-size: 11px;
		font-family: inherit;
		padding: 2px 6px;
		border-radius: 5px;
		cursor: pointer;
		color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
		background: transparent;
		border: 1px solid var(--color-border);
	}
	.ip-clear:hover {
		color: var(--color-foreground);
	}
	.ip-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
		padding: 0 8px 10px;
		max-height: 240px;
		overflow-y: auto;
		scrollbar-width: thin;
	}
	.ip-cell {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border-radius: 7px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: color-mix(in srgb, var(--color-foreground) 80%, transparent);
		transition: background 100ms ease;
	}
	.ip-cell.emoji {
		font-size: 19px;
		line-height: 1;
	}
	.ip-cell:hover {
		background: color-mix(in srgb, var(--color-foreground) 10%, transparent);
	}
	.ip-cell.sel {
		background: color-mix(in srgb, var(--color-accent) 28%, transparent);
	}
	.ip-empty {
		grid-column: 1 / -1;
		text-align: center;
		font-size: 12px;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
		padding: 16px 0;
		margin: 0;
	}
</style>
