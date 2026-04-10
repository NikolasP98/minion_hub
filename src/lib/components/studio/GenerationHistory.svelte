<script lang="ts">
	import { studioState, restoreFromHistory, type GeneratedImage } from '$lib/state/features/studio.svelte';
	import { Clock } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';

	function relativeTime(ts: number): string {
		const diff = Math.floor((Date.now() - ts) / 1000);
		if (diff < 60) return m.studio_justNow();
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return new Date(ts).toLocaleDateString();
	}
</script>

<div class="border-t border-border bg-bg/80 backdrop-blur-sm">
	<div class="flex items-center gap-1.5 px-3 pt-2">
		<Clock class="h-3 w-3 text-muted" />
		<span class="text-[10px] font-semibold text-muted uppercase tracking-wider">{m.studio_history()}</span>
	</div>

	{#if studioState.history.length === 0}
		<div class="flex items-center justify-center py-3">
			<span class="text-xs text-muted">{m.studio_historyEmpty()}</span>
		</div>
	{:else}
		<div class="history-scroll overflow-x-auto flex gap-2 py-2 px-3">
			{#each studioState.history as img (img.id)}
				<button
					type="button"
					class="flex-shrink-0 flex flex-col items-center gap-0.5 cursor-pointer bg-transparent border-none p-0"
					onclick={() => restoreFromHistory(img)}
				>
					<img
						src="data:{img.mimeType};base64,{img.base64}"
						alt="Generated at {new Date(img.timestamp).toLocaleTimeString()}"
						class="h-16 w-auto rounded-md object-cover transition-opacity duration-150
							{studioState.currentImage?.id === img.id
							? 'ring-2 ring-[var(--color-brand-pink)] opacity-100'
							: 'opacity-70 hover:opacity-100'}"
					/>
					<span class="text-[9px] text-muted">{relativeTime(img.timestamp)}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.history-scroll::-webkit-scrollbar {
		height: 4px;
	}

	.history-scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.history-scroll::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: 2px;
	}
</style>
