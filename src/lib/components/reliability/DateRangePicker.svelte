<script lang="ts">
  import { Button } from '$lib/components/ui';
	import { ChevronDown } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		from: number;
		to: number;
		onchange: (from: number, to: number) => void;
	}

	let { from, to, onchange }: Props = $props();

	const presets = [
		{ label: '1h',  ms:       60 * 60 * 1000 },
		{ label: '24h', ms: 24 * 60 * 60 * 1000 },
		{ label: '7d',  ms: 7 * 24 * 60 * 60 * 1000 },
		{ label: '30d', ms: 30 * 24 * 60 * 60 * 1000 }
	] as const;

	let activePreset: string | null = $derived.by(() => {
		const now = Date.now();
		for (const preset of presets) {
			const expectedFrom = now - preset.ms;
			// Allow 5 seconds of tolerance for matching
			if (Math.abs(from - expectedFrom) < 5000 && Math.abs(to - now) < 5000) {
				return preset.label;
			}
		}
		return null;
	});

	// ── Mobile dropdown state ─────────────────────────────────────────────
	let open = $state(false);

	function applyPreset(ms: number, label: string) {
		const now = Date.now();
		onchange(now - ms, now);
		open = false;
	}

	function epochToDateString(epoch: number): string {
		const d = new Date(epoch);
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function handleFromChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const parsed = new Date(target.value).getTime();
		if (!isNaN(parsed)) {
			onchange(parsed, to);
		}
	}

	function handleToChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const parsed = new Date(target.value).getTime();
		if (!isNaN(parsed)) {
			onchange(from, parsed);
		}
	}

	let fromDateStr = $derived(epochToDateString(from));
	let toDateStr = $derived(epochToDateString(to));
	let triggerLabel = $derived(activePreset ?? m.dateRange_custom());
</script>

<!-- Desktop: inline layout (>=640px) -->
<div class="hidden sm:flex flex-row items-end gap-2">
	<div class="flex flex-row items-center gap-1.5">
		{#each presets as preset (preset.label)}
			<Button
				variant={activePreset === preset.label ? 'primary' : 'outline'}
				size="sm"
				class="rounded-full"
				aria-pressed={activePreset === preset.label}
				onclick={() => applyPreset(preset.ms, preset.label)}
			>
				{preset.label}
			</Button>
		{/each}
	</div>

	<div class="flex flex-col gap-0.5">
		<label for="date-from" class="text-xs text-muted-foreground leading-none">{m.dateRange_from()}</label>
		<input
			id="date-from"
			type="date"
			value={fromDateStr}
			onchange={handleFromChange}
			class="text-xs py-1 px-2 bg-bg3 text-foreground border border-border rounded-md font-[inherit] leading-snug outline-none [color-scheme:dark] focus:border-accent"
		/>
	</div>

	<div class="flex flex-col gap-0.5">
		<label for="date-to" class="text-xs text-muted-foreground leading-none">{m.dateRange_to()}</label>
		<input
			id="date-to"
			type="date"
			value={toDateStr}
			onchange={handleToChange}
			class="text-xs py-1 px-2 bg-bg3 text-foreground border border-border rounded-md font-[inherit] leading-snug outline-none [color-scheme:dark] focus:border-accent"
		/>
	</div>
</div>

<!-- Mobile: dropdown trigger + panel (<640px) -->
<div class="relative sm:hidden">
	<Button
		type="button"
		variant={activePreset ? 'primary' : 'outline'}
		size="sm"
		class="rounded-full"
		aria-expanded={open}
		aria-controls="mobile-date-range-panel"
		onclick={() => (open = !open)}
	>
		{triggerLabel}
		<ChevronDown size={12} class="transition-transform duration-[var(--duration-fast)] {open ? 'rotate-180' : ''}" />
	</Button>

	{#if open}
		<!-- Backdrop -->
		<Button variant="ghost" size="icon"
			type="button"
			class="!fixed !inset-0 !z-[var(--layer-modal-backdrop,40)] !h-auto !w-auto !rounded-none"
			onclick={() => (open = false)}
			aria-label={m.dateRange_closePicker()}
		></Button>

		<!-- Dropdown panel -->
		<div id="mobile-date-range-panel" class="absolute right-0 top-full mt-1 z-[var(--layer-overlay,50)] bg-card border border-border rounded-lg shadow-lg p-3 min-w-[220px]">
			<div class="flex flex-row items-center gap-1.5 mb-3">
				{#each presets as preset (preset.label)}
					<Button
						variant={activePreset === preset.label ? 'primary' : 'outline'}
						size="sm"
						class="rounded-full"
						aria-pressed={activePreset === preset.label}
						onclick={() => applyPreset(preset.ms, preset.label)}
					>
						{preset.label}
					</Button>
				{/each}
			</div>

			<div class="flex flex-col gap-2">
				<div class="flex flex-col gap-0.5">
					<label for="date-from-mobile" class="text-xs text-muted-foreground leading-none">{m.dateRange_from()}</label>
					<input
						id="date-from-mobile"
						type="date"
						value={fromDateStr}
						onchange={handleFromChange}
						class="text-xs py-1.5 px-2 bg-bg3 text-foreground border border-border rounded-md font-[inherit] leading-snug outline-none [color-scheme:dark] focus:border-accent w-full"
					/>
				</div>
				<div class="flex flex-col gap-0.5">
					<label for="date-to-mobile" class="text-xs text-muted-foreground leading-none">{m.dateRange_to()}</label>
					<input
						id="date-to-mobile"
						type="date"
						value={toDateStr}
						onchange={handleToChange}
						class="text-xs py-1.5 px-2 bg-bg3 text-foreground border border-border rounded-md font-[inherit] leading-snug outline-none [color-scheme:dark] focus:border-accent w-full"
					/>
				</div>
			</div>
		</div>
	{/if}
</div>
