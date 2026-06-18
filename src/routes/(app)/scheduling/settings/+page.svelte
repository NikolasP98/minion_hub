<script lang="ts">
	import { Settings } from 'lucide-svelte';
	import { PageHeader, Card } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head><title>{m.sched_nav_settings()} · {m.nav_scheduling()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.sched_nav_settings()} subtitle={m.nav_scheduling()}>
		{#snippet leading()}
			<Settings size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>
	<div class="flex-1 min-h-0 overflow-auto p-4">
		<Card padding="lg" class="max-w-xl">
			<p class="text-sm text-[var(--color-muted-foreground)]">
				{m.sched_module_scheduling_desc()}
			</p>
			<p class="mt-3 text-sm">
				<a href="/settings/modules" class="text-accent underline">{m.settings_modules()}</a>
			</p>
		</Card>
	</div>
</div>
