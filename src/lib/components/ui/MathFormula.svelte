<script lang="ts">
	// Renders a LaTeX string with KaTeX. The KaTeX engine is lazy-imported (it's
	// ~270KB) the same way Chart.svelte defers echarts, so it never weighs on the
	// initial route load; the (small) stylesheet is bundled statically so glyphs
	// are ready the instant the engine resolves. Falls back to the raw source text
	// if KaTeX fails to parse, so a bad formula degrades gracefully.
	//
	// Auto-fit: after rendering we scale the formula down (left-anchored) if it's
	// wider than its container, so a long substituted expression shrinks to fit a
	// fixed-width tooltip instead of clipping or scrolling.
	import 'katex/dist/katex.min.css';

	let {
		tex,
		displayMode = false,
		class: cls = '',
	}: { tex: string; displayMode?: boolean; class?: string } = $props();

	let host = $state<HTMLSpanElement>();
	let inner = $state<HTMLSpanElement>();

	$effect(() => {
		const src = tex;
		const dm = displayMode;
		if (!inner) return;
		const target = inner;
		import('katex')
			.then((katex) => {
				if (!target) return;
				try {
					katex.default.render(src, target, { displayMode: dm, throwOnError: false, output: 'html' });
				} catch {
					target.textContent = src;
				}
				// Fit-to-width: measure AFTER a frame so KaTeX's layout has flushed,
				// then scale down (with a 1px safety margin) only when overflowing.
				target.style.transform = '';
				requestAnimationFrame(() => {
					if (!target) return;
					const cw = host?.clientWidth ?? 0;
					const iw = target.scrollWidth;
					target.style.transform = cw > 0 && iw > cw ? `scale(${(cw - 1) / iw})` : '';
				});
			})
			.catch(() => {
				if (target) target.textContent = src;
			});
	});
</script>

<span bind:this={host} class="block overflow-hidden {cls}">
	<span bind:this={inner} class="inline-block whitespace-nowrap" style="transform-origin:left center"></span>
</span>
