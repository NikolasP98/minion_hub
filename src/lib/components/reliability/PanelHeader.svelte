<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Optional leading icon, rendered as a snippet so callers control the component + props. */
		icon?: Snippet;
		label: string;
		/** Extra classes appended to the label span (e.g. `flex-1`, `shrink-0`). */
		labelClass?: string;
		/** Extra classes appended to the header wrapper (e.g. `flex-wrap gap-y-1.5`). */
		class?: string;
		/** Trailing content rendered after the label (status dots, counts, filter controls). */
		actions?: Snippet;
	}

	let { icon, label, labelClass = '', class: extraClass = '', actions }: Props = $props();
</script>

<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20 {extraClass}">
	{@render icon?.()}
	<span
		class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground {labelClass}"
		>{label}</span
	>
	{@render actions?.()}
</div>
