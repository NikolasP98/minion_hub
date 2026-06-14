<script lang="ts">
	// Renders `text` with case-insensitive occurrences of `query` wrapped in <mark>.
	// Splitting on a single capturing group puts matches at odd indices while
	// preserving the original casing of the matched substring.
	let { text, query = '' }: { text: string | null | undefined; query?: string } = $props();

	const segments = $derived.by(() => {
		const src = text ?? '';
		const q = query.trim();
		if (!q || !src) return [{ t: src, m: false }];
		const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return src.split(new RegExp(`(${esc})`, 'i')).map((t, i) => ({ t, m: i % 2 === 1 }));
	});
</script>

{#each segments as s, i (i)}{#if s.m}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}

<style>
	mark {
		background: color-mix(in srgb, var(--color-accent) 38%, transparent);
		color: inherit;
		border-radius: 2px;
		padding: 0 1px;
	}
</style>
