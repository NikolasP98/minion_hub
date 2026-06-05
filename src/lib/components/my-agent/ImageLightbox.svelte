<script lang="ts">
	import { X } from 'lucide-svelte';

	let { src, onclose }: { src: string | null; onclose: () => void } = $props();

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if src}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="lightbox"
		onclick={onclose}
		role="dialog"
		aria-modal="true"
		aria-label="Image preview"
		tabindex="-1"
	>
		<button type="button" class="close" title="Close" aria-label="Close" onclick={onclose}>
			<X size={20} />
		</button>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<img {src} alt="" onclick={(e) => e.stopPropagation()} />
	</div>
{/if}

<style>
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 5vh 5vw;
		background: rgba(0, 0, 0, 0.82);
		backdrop-filter: blur(6px);
		cursor: zoom-out;
	}
	.lightbox img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: 8px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
		cursor: default;
	}
	.close {
		position: absolute;
		top: 18px;
		right: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px;
		border-radius: 9px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.85);
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.14);
		transition: background 120ms ease;
	}
	.close:hover {
		background: rgba(255, 255, 255, 0.16);
	}
</style>
