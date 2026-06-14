<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { label = m.live_default(), intervalMs = 5000 }: { label?: string; intervalMs?: number } = $props();
</script>

<span
	class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
	title={m.live_refreshing({ seconds: Math.round(intervalMs / 1000).toString() })}
>
	<span class="relative flex h-2 w-2">
		<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70"></span>
		<span class="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
	</span>
	{label}
</span>
