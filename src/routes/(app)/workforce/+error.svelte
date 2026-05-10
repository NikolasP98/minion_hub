<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="p-6">
	<h1 class="text-xl font-semibold">Something went wrong</h1>
	<p class="text-muted-foreground mt-2">{page.error?.message ?? 'unknown error'}</p>
	<button class="mt-4 rounded border px-3 py-1 text-sm" onclick={() => location.reload()}>
		Retry
	</button>
</div>
