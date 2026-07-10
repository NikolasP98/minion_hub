<script lang="ts">
	import type { LucideIcon } from '$lib/nav/routes';

	export interface MessageAction {
		icon: LucideIcon;
		label: string;
		onclick: () => void;
		/** Transient confirmation label swapped in after click (e.g. "Copied"). */
		done?: string;
	}

	// Vertical icon rail beside a message block. Icons are always visible; the
	// group expands to show labels on hover. For blocks taller than the viewport
	// the rail sticks to the bottom of the visible area (position: sticky).
	const { actions, side = 'right' }: { actions: MessageAction[]; side?: 'left' | 'right' } =
		$props();

	let doneIdx = $state<number | null>(null);
	let doneTimer: ReturnType<typeof setTimeout> | null = null;

	function run(a: MessageAction, i: number) {
		a.onclick();
		if (a.done) {
			doneIdx = i;
			if (doneTimer) clearTimeout(doneTimer);
			doneTimer = setTimeout(() => (doneIdx = null), 1400);
		}
	}
</script>

<div class="rail" class:left={side === 'left'} aria-label="Message actions">
	{#each actions as a, i (i)}
		<button type="button" class="act" title={a.label} onclick={() => run(a, i)}>
			<a.icon size={13} />
			<span class="label">{doneIdx === i && a.done ? a.done : a.label}</span>
		</button>
	{/each}
</div>

<style>
	.rail {
		position: sticky;
		bottom: 8px;
		align-self: flex-end;
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex-shrink: 0;
		/* Fade in with the row but never intercept scroll on the empty gutter. */
		opacity: 0.55;
		transition: opacity 140ms ease;
	}
	.rail.left {
		align-items: flex-end;
	}
	.rail:hover {
		opacity: 1;
	}

	.act {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 26px;
		height: 24px;
		padding: 0 6px;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
		border-radius: 6px;
		background: color-mix(in srgb, var(--color-bg2) 70%, transparent);
		color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
		cursor: pointer;
		overflow: hidden;
		white-space: nowrap;
		transition: max-width 160ms ease, color 120ms ease, background 120ms ease,
			border-color 120ms ease;
	}
	.rail.left .act {
		flex-direction: row-reverse;
	}
	.act > :global(svg) {
		flex-shrink: 0;
	}
	.act:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
		border-color: color-mix(in srgb, var(--color-foreground) 16%, transparent);
	}
	/* Expand every button to reveal its label when the group is hovered. */
	.rail:hover .act {
		max-width: 120px;
	}
	.label {
		font-size: 11px;
		line-height: 1;
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.rail:hover .label {
		opacity: 1;
	}
</style>
