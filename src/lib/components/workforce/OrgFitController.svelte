<script lang="ts">
	import { useSvelteFlow } from '@xyflow/svelte';

	// Re-frames the chart with an animated viewport transition whenever `trigger`
	// changes (e.g. the layout flips vertical↔horizontal). Must live inside
	// <SvelteFlow> so the flow instance is in context.
	let { trigger }: { trigger: unknown } = $props();
	const { fitView } = useSvelteFlow();

	$effect(() => {
		// touch the dependency so the effect re-runs on change
		void trigger;
		// next frame: let the repositioned nodes mount before fitting
		requestAnimationFrame(() => fitView({ padding: 0.15, duration: 450 }));
	});
</script>
