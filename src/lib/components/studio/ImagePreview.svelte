<script lang="ts">
	import { studioState, generate, getAspectRatio } from '$lib/state/features/studio.svelte';
	import { Paintbrush, Download, RefreshCw, Loader2 } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';

	let aspectRatio = $derived(getAspectRatio(studioState.imageFormat));
	let img = $derived(studioState.currentImage);
	let isGenerating = $derived(studioState.generating);
	let error = $derived(studioState.error);

	function downloadImage() {
		if (!studioState.currentImage) return;
		const { base64, mimeType, selections } = studioState.currentImage;
		const a = document.createElement('a');
		a.href = `data:${mimeType};base64,${base64}`;
		a.download = `studio-${selections.contentType}-${Date.now()}.png`;
		a.click();
	}
</script>

{#if isGenerating}
	<!-- Loading state -->
	<div
		class="flex items-center justify-center animate-pulse bg-bg2 rounded-xl"
		style:aspect-ratio={aspectRatio}
	>
		<div class="flex flex-col items-center gap-3">
			<Loader2 class="animate-spin text-muted" size={48} />
			<span class="text-muted text-sm">{m.studio_generating()}</span>
		</div>
	</div>
{:else if img}
	<!-- Result state -->
	<div class="flex flex-col gap-3">
		<div
			class="rounded-xl overflow-hidden bg-bg2"
			style:aspect-ratio={aspectRatio}
		>
			<img
				src="data:{img.mimeType};base64,{img.base64}"
				alt="Generated {img.selections.contentType}"
				class="w-full h-full object-contain"
			/>
		</div>

		{#if error}
			<p class="text-destructive text-sm">{error}</p>
		{/if}

		<div class="flex items-center gap-2">
			<button
				type="button"
				class="inline-flex items-center gap-2 bg-bg3 text-foreground hover:bg-bg3/80 rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
				onclick={generate}
			>
				<RefreshCw size={16} />
				{m.studio_generateAgain()}
			</button>
			<button
				type="button"
				class="inline-flex items-center gap-2 bg-bg3 text-foreground hover:bg-bg3/80 rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
				onclick={downloadImage}
			>
				<Download size={16} />
				{m.studio_download()}
			</button>
		</div>
	</div>
{:else}
	<!-- Empty state -->
	<div
		class="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl gap-3"
		style:aspect-ratio={aspectRatio}
	>
		{#if error}
			<p class="text-destructive text-sm text-center px-4">{error}</p>
			<button
				type="button"
				class="inline-flex items-center gap-2 bg-bg3 text-foreground hover:bg-bg3/80 rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
				onclick={generate}
			>
				<RefreshCw size={16} />
				{m.studio_retry()}
			</button>
		{:else}
			<Paintbrush class="text-muted" size={48} />
			<h3 class="text-foreground text-lg font-semibold">{m.studio_emptyTitle()}</h3>
			<p class="text-muted text-sm">{m.studio_emptyDescription()}</p>
		{/if}
	</div>
{/if}
