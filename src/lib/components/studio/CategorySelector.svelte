<script lang="ts">
	interface Props {
		label: string;
		options: { id: string; label: string; icon: string }[];
		value: string;
		onchange: (value: string) => void;
		compact?: boolean;
	}

	let { label, options, value, onchange, compact = false }: Props = $props();
</script>

<div class="category-section space-y-1.5">
	<span class="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</span>
	<div class="flex flex-wrap gap-1.5">
		{#each options as opt (opt.id)}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 border transition-all duration-150 cursor-pointer
					{compact ? 'px-2 py-1 rounded-sm text-[11px]' : 'px-2.5 py-1.5 rounded-md text-xs'}
					{value === opt.id
					? 'border-accent bg-accent/8 text-accent'
					: 'border-border bg-card text-muted-foreground hover:border-muted hover:text-foreground'}"
				onclick={() => onchange(opt.id)}
			>
				{#if opt.icon}
					<span class="font-mono leading-none {compact ? 'text-sm' : 'text-base'}">{opt.icon}</span>
				{/if}
				<span class="font-medium leading-none">{opt.label}</span>
			</button>
		{/each}
	</div>
</div>
