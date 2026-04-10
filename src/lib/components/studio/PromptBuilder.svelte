<script lang="ts">
	import CategorySelector from './CategorySelector.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import {
		studioState,
		generate,
		CATEGORIES,
		IMAGE_MODELS,
		type ImageModel,
		type StudioSelections,
	} from '$lib/state/features/studio.svelte';
	import { Sparkles, Loader2 } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';

	const currentModelCost = $derived(
		IMAGE_MODELS.find((model) => model.id === studioState.model)?.costPerImage ?? 0,
	);
</script>

<div class="prompt-builder">
	<!-- Scrollable categories area -->
	<div class="categories-scroll">
		{#each CATEGORIES as category (category.key)}
			<CategorySelector
				label={category.label}
				options={category.options}
				value={studioState[category.key] as string}
				onchange={(v) => {
					(studioState as any)[category.key] = v;
				}}
			/>
		{/each}
	</div>

	<!-- Bottom sticky area -->
	<div class="bottom-actions">
		<!-- Refine textarea -->
		<div class="refine-section">
			<label for="studio-refine" class="refine-label">{m.studio_refine()}</label>
			<textarea
				id="studio-refine"
				bind:value={studioState.refineText}
				maxlength={200}
				placeholder={m.studio_refinePlaceholder()}
				rows="2"
				class="refine-textarea"
			></textarea>
			<span class="char-count" class:warning={studioState.refineText.length > 180}>
				{studioState.refineText.length}/200
			</span>
		</div>

		<!-- Model picker -->
		<div class="model-section">
			<Combobox
				id="studio-model"
				items={IMAGE_MODELS}
				itemToValue={(model) => model.id}
				itemToString={(model) => model.label}
				bind:value={studioState.model}
				label={m.studio_model()}
			>
				{#snippet item({ item: model, selected, itemTextProps })}
					<span class="model-item" class:model-selected={selected} {...itemTextProps}>
						<span class="model-info">
							<span class="model-name">{model.label}</span>
							<span class="model-provider">{model.provider}</span>
						</span>
						<span class="model-cost">{model.costPerImage === 0 ? m.studio_free() : `~$${model.costPerImage.toFixed(2)}`}</span>
					</span>
				{/snippet}
			</Combobox>
		</div>

		<!-- Generate button -->
		<button onclick={generate} disabled={studioState.generating} class="generate-btn">
			{#if studioState.generating}
				<Loader2 size={16} class="animate-spin" />
				{m.studio_generating()}
			{:else}
				<Sparkles size={16} />
				{m.studio_generate()}
				{#if currentModelCost > 0}
					<span class="cost-badge">~${currentModelCost.toFixed(2)}</span>
				{/if}
			{/if}
		</button>
	</div>
</div>

<style>
	.prompt-builder {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.categories-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.categories-scroll::-webkit-scrollbar {
		width: 6px;
	}

	.categories-scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.categories-scroll::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: 3px;
	}

	.bottom-actions {
		padding: 16px;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: var(--color-bg);
	}

	.refine-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.refine-label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted);
	}

	.refine-textarea {
		width: 100%;
		background: var(--color-bg2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 12px;
		font-size: 14px;
		color: var(--color-foreground);
		resize: none;
		transition: border-color 0.15s ease;
	}

	.refine-textarea::placeholder {
		color: color-mix(in srgb, var(--color-muted-foreground) 50%, transparent);
	}

	.refine-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.char-count {
		font-size: 10px;
		color: var(--color-muted);
		text-align: right;
	}

	.char-count.warning {
		color: var(--color-warning);
	}

	.generate-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 12px 16px;
		background: var(--color-brand-pink);
		border: none;
		border-radius: 8px;
		color: white;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.generate-btn:hover:not(:disabled) {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.generate-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	.cost-badge {
		font-size: 11px;
		font-weight: 500;
		opacity: 0.7;
		margin-left: 2px;
	}

	.model-section {
		display: flex;
		flex-direction: column;
	}

	.model-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		gap: 8px;
	}

	.model-info {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}

	.model-name {
		color: var(--color-foreground);
	}

	.model-provider {
		font-size: 10px;
		color: var(--color-muted);
		opacity: 0.7;
	}

	.model-cost {
		font-size: 11px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}

	.model-selected .model-name {
		color: var(--color-accent);
		font-weight: 600;
	}
</style>
