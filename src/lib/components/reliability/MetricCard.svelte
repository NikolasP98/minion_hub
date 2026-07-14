<script lang="ts">
	interface Props {
		label: string;
		value: string | number;
		/** Classes appended to the value span after the shared `text-lg font-bold` base. */
		valueClass?: string;
		/** Classes for the cell wrapper (defaults to the shared reliability metric cell). */
		wrapperClass?: string;
	}

	let {
		label,
		value,
		valueClass = '',
		wrapperClass = 'flex flex-col items-center gap-1 py-3 px-2 bg-card'
	}: Props = $props();
</script>

<div class={wrapperClass}>
	<span class="text-[length:var(--font-size-telemetry)] text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
	<span class="text-lg font-bold {valueClass}">{value}</span>
</div>
