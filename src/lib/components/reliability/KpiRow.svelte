<script lang="ts">
	// Activity is imported only to borrow its type — every concrete lucide icon
	// shares one structural type, so `typeof Activity` accepts Gauge/Timer/etc.
	// (the base `Icon` export requires an iconNode prop the concrete icons omit).
	import { Activity } from 'lucide-svelte';
	import { iconSizes } from '$lib/components/ui';

	// One KPI cell. `detail` (optional) carries the hover-breakdown payload the
	// page renders in its fixed tooltip; cells without a detail are static reads
	// (point-in-time infra vitals) and get no hover affordance.
	export interface KpiItem {
		key: string;
		Icon: typeof Activity;
		/** Resolved colour string (accent stripe + value + icon). */
		color: string;
		label: string;
		value: string | number;
		unit?: string;
		subtext?: string;
		/** Opaque hover-breakdown payload; passed straight back to onHover. */
		detail?: unknown;
	}

	let {
		items,
		cols = 8,
		onHover,
		onLeave,
	}: {
		items: KpiItem[];
		/** Column count at the widest breakpoint (8 or 6). Collapses to half, then 2. */
		cols?: 8 | 6;
		onHover?: (e: MouseEvent | FocusEvent, detail: unknown) => void;
		onLeave?: () => void;
	} = $props();

	// Tailwind needs static class strings (JIT can't see interpolated ones), so the
	// responsive grid is a fixed lookup per supported column count.
	const GRID: Record<number, string> = {
		8: 'grid-cols-8 max-[1100px]:grid-cols-4 max-[700px]:grid-cols-2',
		6: 'grid-cols-6 max-[1100px]:grid-cols-3 max-[700px]:grid-cols-2',
	};
	let gridClass = $derived(GRID[cols] ?? GRID[8]);
</script>

<div class="surface-2 rounded-lg overflow-hidden">
	<div class="grid {gridClass} divide-x divide-border/60">
		{#each items as item (item.key)}
			{@const Icon = item.Icon}
			<!-- tabindex is set only together with role="button" (both gated on item.detail),
			     so a focusable cell is always interactive; the analyzer can't correlate the ternaries. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="relative px-5 pt-4 pb-4 flex flex-col gap-1.5 transition-colors outline-none {item.detail
					? 'cursor-help hover:bg-bg3/30 focus-visible:bg-bg3/30'
					: ''}"
				role={item.detail ? 'button' : undefined}
				tabindex={item.detail ? 0 : undefined}
				aria-label={item.detail ? `${item.label}: ${item.value}${item.unit ?? ''}` : undefined}
				onmouseenter={item.detail ? (e) => onHover?.(e, item.detail) : undefined}
				onmouseleave={item.detail ? onLeave : undefined}
				onfocus={item.detail ? (e) => onHover?.(e, item.detail) : undefined}
				onblur={item.detail ? onLeave : undefined}
			>
				<!-- Coloured top accent stripe -->
				<div class="absolute top-0 left-0 right-0 h-[2px]" style:background={item.color}></div>
				<div class="flex items-center gap-1.5 mt-0.5">
					<span style:color={item.color} class="shrink-0 flex"><Icon size={iconSizes.xs} /></span>
					<span
						class="text-xs font-semibold text-muted-foreground uppercase tracking-widest truncate"
						>{item.label}</span
					>
				</div>
				<div class="flex items-baseline gap-0.5">
					<span
						class="text-3xl font-bold font-mono tabular-nums leading-none tracking-tight"
						style:color={item.color}
					>
						{item.value}
					</span>
					{#if item.unit}
						<span class="text-sm font-semibold text-muted-foreground leading-none">{item.unit}</span>
					{/if}
				</div>
				<span class="text-xs text-muted-strong tabular-nums truncate min-h-[12px]">{item.subtext ?? ''}</span>
			</div>
		{/each}
	</div>
</div>
