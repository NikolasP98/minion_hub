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

<div class="date-range-picker">
	<div class="presets">
		{#each presets as preset (preset.label)}
			<button
				class="preset-btn"
				class:active={activePreset === preset.label}
				onclick={() => applyPreset(preset.ms, preset.label)}
			>
				{preset.label}
			</button>
		{/each}
	</div>

	<div class="date-field">
		<label for="date-from">From</label>
		<input
			id="date-from"
			type="date"
			value={fromDateStr}
			onchange={handleFromChange}
		/>
	</div>

	<div class="date-field">
		<label for="date-to">To</label>
		<input
			id="date-to"
			type="date"
			value={toDateStr}
			onchange={handleToChange}
		/>
	</div>
</div>

<style>
	.date-range-picker {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}

	.presets {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}

	.preset-btn {
		font-size: 12px;
		padding: 4px 12px;
		border-radius: 14px;
		background: var(--bg3, #1e293b);
		color: var(--text2, #94a3b8);
		border: 1px solid var(--border, #2a3548);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
		white-space: nowrap;
		line-height: 1.4;
		font-family: inherit;
	}

	.preset-btn:hover {
		background: var(--border, #2a3548);
		color: var(--text, #e2e8f0);
	}

	.preset-btn.active {
		background: var(--accent, #3b82f6);
		color: white;
		border-color: var(--accent, #3b82f6);
	}

	.date-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.date-field label {
		font-size: 11px;
		color: var(--text3, #64748b);
		line-height: 1;
	}

	.date-field input[type='date'] {
		font-size: 12px;
		padding: 4px 8px;
		background: var(--bg3, #1e293b);
		color: var(--text, #e2e8f0);
		border: 1px solid var(--border, #2a3548);
		border-radius: 6px;
		font-family: inherit;
		line-height: 1.4;
		outline: none;
		color-scheme: dark;
	}

	.date-field input[type='date']:focus {
		border-color: var(--accent, #3b82f6);
	}
</style>
