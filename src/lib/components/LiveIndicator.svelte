<script lang="ts">
	let { label = 'Live', intervalMs = 5000 }: { label?: string; intervalMs?: number } = $props();
</script>

<span
	class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
	title="Auto-refreshing every {Math.round(intervalMs / 1000)}s"
>
	<span class="relative flex h-2 w-2">
		<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-70"></span>
		<span class="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
	</span>
	{label}
</span>
