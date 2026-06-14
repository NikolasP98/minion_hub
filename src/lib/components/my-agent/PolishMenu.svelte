<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Users, AlignLeft, AlignJustify, Briefcase, ListChecks, Wand2 } from 'lucide-svelte';
	import { NOTE_POLISH_INTENTS, type NotePolishIntent } from '$lib/state/features/notes-autocomplete';

	let { onpick, onclose }: { onpick: (i: NotePolishIntent) => void; onclose: () => void } = $props();

	const ICONS: Record<NotePolishIntent, typeof Users> = {
		meeting: Users,
		short: AlignLeft,
		long: AlignJustify,
		formal: Briefcase,
		actions: ListChecks
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pm" role="menu" tabindex="-1" onmousedown={(e) => e.stopPropagation()} aria-label={m.polishMenu_polishOptions()}>
	<div class="pm-head"><Wand2 size={13} /> {m.polishMenu_polishAs()}</div>
	{#each NOTE_POLISH_INTENTS as it (it.id)}
		{@const Icon = ICONS[it.id]}
		<button type="button" role="menuitem" class="pm-item" onclick={() => { onpick(it.id); onclose(); }}>
			<Icon size={14} />
			{it.label}
		</button>
	{/each}
</div>

<style>
	.pm {
		min-width: 168px;
		display: flex;
		flex-direction: column;
		padding: 5px;
		border-radius: 10px;
		background: var(--color-bg2, #1b1b1f);
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 12px 34px rgba(0, 0, 0, 0.6);
	}
	.pm-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 9px 7px;
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
	}
	.pm-head :global(svg) {
		color: rgba(167, 139, 250, 0.9);
	}
	.pm-item {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 8px 9px;
		font-size: 12.5px;
		font-family: inherit;
		text-align: left;
		border-radius: 6px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: color-mix(in srgb, var(--color-foreground) 84%, transparent);
		transition: background 120ms ease, color 120ms ease;
	}
	.pm-item:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
	.pm-item :global(svg) {
		color: var(--color-accent);
		flex-shrink: 0;
	}
</style>
