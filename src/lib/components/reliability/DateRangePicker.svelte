<script lang="ts">
	interface Props {
		from: number;
		to: number;
		onchange: (from: number, to: number) => void;
	}

	let { from, to, onchange }: Props = $props();

	const presets = [
		{ label: '24h', ms: 24 * 60 * 60 * 1000 },
		{ label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
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

	function applyPreset(ms: number, label: string) {
		const now = Date.now();
		onchange(now - ms, now);
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
</script>

<div class="flex flex-row items-center gap-2">
	<div class="flex flex-row items-center gap-1.5">
		{#each presets as preset (preset.label)}
			<button
				class="text-xs py-1 px-3 rounded-full border cursor-pointer whitespace-nowrap leading-snug font-[inherit] transition-colors duration-150
					{activePreset === preset.label
						? 'bg-accent text-white border-accent'
						: 'bg-bg3 text-muted border-border hover:bg-border hover:text-foreground'}"
				onclick={() => applyPreset(preset.ms, preset.label)}
			>
				{preset.label}
			</button>
		{/each}
	</div>

	<div class="flex flex-col gap-0.5">
		<label for="date-from" class="text-[11px] text-muted-foreground leading-none">From</label>
		<input
			id="date-from"
			type="date"
			value={fromDateStr}
			onchange={handleFromChange}
			class="text-xs py-1 px-2 bg-bg3 text-foreground border border-border rounded-md font-[inherit] leading-snug outline-none [color-scheme:dark] focus:border-accent"
		/>
	</div>

	<div class="flex flex-col gap-0.5">
		<label for="date-to" class="text-[11px] text-muted-foreground leading-none">To</label>
		<input
			id="date-to"
			type="date"
			value={toDateStr}
			onchange={handleToChange}
			class="text-xs py-1 px-2 bg-bg3 text-foreground border border-border rounded-md font-[inherit] leading-snug outline-none [color-scheme:dark] focus:border-accent"
		/>
	</div>
</div>
