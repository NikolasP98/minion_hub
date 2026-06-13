<script lang="ts">
	// Renders a LaTeX string with KaTeX. The KaTeX engine is lazy-imported (it's
	// ~270KB) the same way Chart.svelte defers echarts, so it never weighs on the
	// initial route load; the (small) stylesheet is bundled statically so glyphs
	// are ready the instant the engine resolves. Falls back to the raw source text
	// if KaTeX fails to parse, so a bad formula degrades gracefully instead of
	// throwing.
	import 'katex/dist/katex.min.css';

	let {
		tex,
		displayMode = false,
		class: cls = '',
	}: { tex: string; displayMode?: boolean; class?: string } = $props();

	let el = $state<HTMLSpanElement>();

	$effect(() => {
		const src = tex;
		const dm = displayMode;
		if (!el) return;
		import('katex')
			.then((katex) => {
				if (!el) return;
				try {
					katex.default.render(src, el, {
						displayMode: dm,
						throwOnError: false,
						output: 'html',
					});
				} catch {
					if (el) el.textContent = src;
				}
			})
			.catch(() => {
				if (el) el.textContent = src;
			});
	});
</script>

<span bind:this={el} class={cls}></span>
