<script lang="ts">
	import type { PageData } from './$types';
	import { Blocks } from 'lucide-svelte';
	import { PageHeader, Toggle } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import { setPluginEnabled, MODULES_QUERY_KEY } from '$lib/state/plugin-nav.svelte';
	import { queryClient } from '$lib/query/client';

	let { data }: { data: PageData } = $props();

	// Default true when absent (absent = enabled per modules.service.ts)
	let finEnabled = $state(
		// svelte-ignore state_referenced_locally
		data.modules['finances'] ?? true,
	);
	let crmEnabled = $state(
		// svelte-ignore state_referenced_locally
		data.modules['crm'] ?? true,
	);
	let schedEnabled = $state(
		// svelte-ignore state_referenced_locally
		data.modules['scheduling'] ?? true,
	);
	let supportEnabled = $state(
		// svelte-ignore state_referenced_locally
		data.modules['support'] ?? true,
	);
	let salesEnabled = $state(
		// svelte-ignore state_referenced_locally
		data.modules['sales'] ?? true,
	);
	let moduleBusy = $state<string | null>(null);
	let moduleMsg = $state<{ id: string; ok: boolean; text: string } | null>(null);

	async function setModule(moduleId: string, enabled: boolean) {
		moduleBusy = moduleId;
		moduleMsg = null;
		try {
			const res = await fetch('/api/modules', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ moduleId, enabled }),
			});
			if (res.ok) {
				setPluginEnabled(moduleId, enabled);
				void queryClient.invalidateQueries({ queryKey: MODULES_QUERY_KEY });
			} else {
				moduleMsg = { id: moduleId, ok: false, text: m.fin_module_error() };
				if (moduleId === 'finances') finEnabled = !enabled;
				if (moduleId === 'crm') crmEnabled = !enabled;
				if (moduleId === 'scheduling') schedEnabled = !enabled;
				if (moduleId === 'support') supportEnabled = !enabled;
				if (moduleId === 'sales') salesEnabled = !enabled;
			}
		} catch {
			moduleMsg = { id: moduleId, ok: false, text: m.fin_module_error() };
			if (moduleId === 'finances') finEnabled = !enabled;
			if (moduleId === 'crm') crmEnabled = !enabled;
			if (moduleId === 'scheduling') schedEnabled = !enabled;
			if (moduleId === 'support') supportEnabled = !enabled;
			if (moduleId === 'sales') salesEnabled = !enabled;
		} finally {
			moduleBusy = null;
		}
	}
</script>

<svelte:head><title>{m.settings_modules()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.settings_modules()} subtitle={m.settings_modules_subtitle()}>
		{#snippet leading()}
			<Blocks size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4">
		<div class="grid gap-4 max-w-2xl">
			<section class="card">
				<header class="card-h">
					<Blocks size={14} />
					<span>{m.fin_modules_card()}</span>
				</header>

				<div class="mod-row">
					<div class="mod-info">
						<span class="mod-label">{m.fin_module_finances()}</span>
						<span class="t-caption">{m.fin_module_finances_desc()}</span>
					</div>
					<Toggle
						bind:checked={finEnabled}
						ariaLabel={m.fin_module_finances()}
						disabled={moduleBusy === 'finances'}
						onchange={(v) => setModule('finances', v)}
						size="md"
					/>
				</div>

				<div class="mod-row">
					<div class="mod-info">
						<span class="mod-label">{m.fin_module_crm()}</span>
						<span class="t-caption">{m.fin_module_crm_desc()}</span>
					</div>
					<Toggle
						bind:checked={crmEnabled}
						ariaLabel={m.fin_module_crm()}
						disabled={moduleBusy === 'crm'}
						onchange={(v) => setModule('crm', v)}
						size="md"
					/>
				</div>

				<div class="mod-row">
					<div class="mod-info">
						<span class="mod-label">{m.sched_module_scheduling()}</span>
						<span class="t-caption">{m.sched_module_scheduling_desc()}</span>
					</div>
					<Toggle
						bind:checked={schedEnabled}
						ariaLabel={m.sched_module_scheduling()}
						disabled={moduleBusy === 'scheduling'}
						onchange={(v) => setModule('scheduling', v)}
						size="md"
					/>
				</div>

				<div class="mod-row">
					<div class="mod-info">
						<span class="mod-label">Support</span>
						<span class="t-caption">Customer support tickets with SLA tracking.</span>
					</div>
					<Toggle
						bind:checked={supportEnabled}
						ariaLabel="Support"
						disabled={moduleBusy === 'support'}
						onchange={(v) => setModule('support', v)}
						size="md"
					/>
				</div>

				<div class="mod-row">
					<div class="mod-info">
						<span class="mod-label">Sales Orders</span>
						<span class="t-caption">Commitments to bill, created from bookings.</span>
					</div>
					<Toggle
						bind:checked={salesEnabled}
						ariaLabel="Sales Orders"
						disabled={moduleBusy === 'sales'}
						onchange={(v) => setModule('sales', v)}
						size="md"
					/>
				</div>

				{#if moduleMsg && !moduleMsg.ok}
					<p class="err-msg mt-2">{moduleMsg.text}</p>
				{/if}
			</section>
		</div>
	</div>
</div>

<style>
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.card-h {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-body);
		font-weight: 600;
		color: var(--color-muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-bottom: var(--space-3);
	}
	.mod-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--hairline);
	}
	.mod-row:last-of-type {
		border-bottom: none;
	}
	.mod-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
	}
	.mod-label {
		font-size: var(--font-size-page-title);
		font-weight: 500;
	}
	.err-msg {
		font-size: var(--font-size-body);
		color: var(--color-destructive);
		margin-bottom: var(--space-2);
	}
</style>
