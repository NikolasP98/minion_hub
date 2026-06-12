<script lang="ts">
	import { StickyNote } from 'lucide-svelte';
	import IconPicker from './IconPicker.svelte';
	import { iconComp } from './note-icons';

	let {
		icon = '',
		onpick,
		size = 16
	}: { icon?: string; onpick: (value: string) => void; size?: number } = $props();

	let open = $state(false);

	const LucideComp = $derived(icon.startsWith('lucide:') ? iconComp(icon.slice(7)) : null);
	const isEmoji = $derived(!!icon && !icon.startsWith('lucide:'));

	function choose(value: string) {
		onpick(value);
	}
</script>

<div class="ni-wrap">
	<button
		type="button"
		class="ni-btn"
		title="Choose an icon"
		aria-label="Choose an icon"
		aria-haspopup="dialog"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		{#if isEmoji}
			<span class="ni-emoji" style:font-size="{size}px">{icon}</span>
		{:else if LucideComp}
			<LucideComp {size} />
		{:else}
			<StickyNote {size} />
		{/if}
	</button>
	{#if open}
		<div class="ni-pop">
			<IconPicker current={icon} onpick={choose} onclose={() => (open = false)} />
		</div>
	{/if}
</div>

<svelte:window
	onpointerdown={(e) => {
		if (open && e.target instanceof Element && !e.target.closest('.ni-wrap')) open = false;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && open) open = false;
	}}
/>

<style>
	.ni-wrap {
		position: relative;
		display: inline-flex;
	}
	.ni-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border-radius: 7px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: var(--color-accent);
		transition: background 120ms ease;
	}
	.ni-btn:hover {
		background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
	}
	.ni-emoji {
		line-height: 1;
	}
	.ni-pop {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 130;
	}
</style>
