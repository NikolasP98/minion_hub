<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { invalidateWorkspaces } from '$lib/state/features/user.svelte';
	import { Select } from '$lib/components/ui';

	type Workspace = { companyId: string; role: string; name: string };

	// Workspaces flow through the (app)/+layout.server.ts bundle into
	// page.data — no client-side fetch on mount required.
	const workspaces = $derived<Workspace[]>(
		((page.data as { workspaces?: Workspace[] })?.workspaces) ?? [],
	);
	// currentCompanyId: We can't read the httpOnly pc_company_id cookie from JS.
	// Default to the first workspace; the real selection is enforced server-side.
	let currentCompanyId = $state<string | null>(null);
	const workspaceOptions = $derived(
		workspaces.map((workspace) => ({ value: workspace.companyId, label: workspace.name })),
	);

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
	<Select
		class="max-w-36"
		size="xs"
		options={workspaceOptions}
		value={currentCompanyId ?? ''}
		onchange={(value) => void select(String(value))}
		aria-label={m.companySwitcher_label()}
	/>
{/if}
