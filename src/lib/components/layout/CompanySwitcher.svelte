<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { invalidateWorkspaces } from '$lib/state/features/user.svelte';

	type Workspace = { companyId: string; role: string; name: string };

	// Workspaces flow through the (app)/+layout.server.ts bundle into
	// page.data — no client-side fetch on mount required.
	const workspaces = $derived<Workspace[]>(
		((page.data as { workspaces?: Workspace[] })?.workspaces) ?? [],
	);
	// currentCompanyId: We can't read the httpOnly pc_company_id cookie from JS.
	// Default to the first workspace; the real selection is enforced server-side.
	let currentCompanyId = $state<string | null>(null);

	onMount(() => {
		currentCompanyId = workspaces[0]?.companyId ?? null;
		// If exactly one workspace, auto-select it so the pc_company_id cookie
		// is set without requiring an explicit dropdown interaction.
		if (workspaces.length === 1 && currentCompanyId) {
			void select(currentCompanyId);
		}
	});

	async function select(companyId: string) {
		const res = await fetch('/api/workspaces/select', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ companyId }),
		});
		if (res.ok) {
			currentCompanyId = companyId;
			await invalidateWorkspaces();
			await invalidateAll();
		}
	}
</script>

{#if workspaces.length > 0}
	<select
		class="switcher"
		value={currentCompanyId}
		onchange={(e) => select((e.currentTarget as HTMLSelectElement).value)}
		aria-label={m.companySwitcher_label()}
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
		transition: border-color var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard);
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
