<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	type Workspace = { companyId: string; role: string; name: string };

	let workspaces = $state<Workspace[]>([]);
	// currentCompanyId: We can't read the httpOnly pc_company_id cookie from JS.
	// Instead we default to the first workspace returned by the API; the real
	// company selection is enforced server-side via the cookie anyway.
	let currentCompanyId = $state<string | null>(null);
	let loading = $state(true);

	onMount(async () => {
		const res = await fetch('/api/workspaces');
		if (res.ok) {
			workspaces = await res.json();
			// Default to first entry — server controls the actual active selection.
			currentCompanyId = workspaces[0]?.companyId ?? null;
		}
		loading = false;
	});

	async function select(companyId: string) {
		const res = await fetch('/api/workspaces/select', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ companyId }),
		});
		if (res.ok) {
			currentCompanyId = companyId;
			await invalidateAll();
		}
	}
</script>

{#if !loading && workspaces.length > 0}
	<select
		class="switcher"
		value={currentCompanyId}
		onchange={(e) => select((e.currentTarget as HTMLSelectElement).value)}
		aria-label="Select company"
	>
		{#each workspaces as w (w.companyId)}
			<option value={w.companyId}>{w.name}</option>
		{/each}
	</select>
{/if}

<style>
	.switcher {
		appearance: none;
		background: var(--color-bg3);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		color: var(--color-foreground);
		cursor: pointer;
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.25rem 1.5rem 0.25rem 0.625rem;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.5rem center;
		transition: border-color 0.15s ease, background-color 0.15s ease;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.switcher:hover {
		border-color: var(--color-accent);
		background-color: var(--color-bg2);
	}

	.switcher:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	/* Options inherit the select bg in most browsers */
	.switcher option {
		background: var(--color-bg2);
		color: var(--color-foreground);
	}
</style>
