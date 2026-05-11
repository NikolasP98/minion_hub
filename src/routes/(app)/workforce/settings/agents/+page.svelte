<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const { agents } = $derived(data);

	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<div class="p-6 space-y-6 max-w-5xl">
	<header>
		<h1 class="text-2xl font-semibold">Agents</h1>
		<p class="text-sm text-muted-foreground mt-1">
			Workforce roster ({agents.length} agent{agents.length !== 1 ? 's' : ''}).
		</p>
	</header>

	<nav class="flex flex-wrap gap-2 text-sm">
		<a href="/workforce/settings" class="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted transition-colors">
			General
		</a>
		<a href="/workforce/settings/agents" class="rounded-md border border-border bg-card px-3 py-1.5 font-medium">
			Agents
			<span class="ml-1 text-xs text-muted-foreground">{agents.length}</span>
		</a>
	</nav>

	{#if agents.length === 0}
		<div class="rounded-lg border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
			<p class="text-muted-foreground text-sm">No agents hired yet.</p>
		</div>
	{:else}
		<ul class="divide-y divide-border rounded-lg border border-border bg-card">
			{#each agents as agent (agent.id)}
				<li class="px-4 py-3 flex items-center gap-3 text-sm">
					<div class="flex-1 min-w-0">
						<div class="font-medium truncate">{agent.name}</div>
						<div class="text-xs text-muted-foreground truncate">
							{#if (agent as any).role}{(agent as any).role} · {/if}
							{(agent as any).adapter ?? 'unknown adapter'}
							{#if (agent as any).model} · <span class="font-mono">{(agent as any).model}</span>{/if}
						</div>
					</div>
					<span class="shrink-0 text-xs text-muted-foreground">{(agent as any).status ?? '—'}</span>
					<time
						class="shrink-0 text-xs text-muted-foreground whitespace-nowrap"
						datetime={new Date(agent.createdAt).toISOString()}
					>
						hired {formatDate(agent.createdAt)}
					</time>
				</li>
			{/each}
		</ul>
	{/if}
</div>
