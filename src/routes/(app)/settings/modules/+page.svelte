<script lang="ts">
	import type { PageData } from './$types';
	import { Blocks } from 'lucide-svelte';
	import { PageHeader, Toggle } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import { setPluginEnabled } from '$lib/state/plugin-nav.svelte';

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
			} else {
				moduleMsg = { id: moduleId, ok: false, text: m.fin_module_error() };
				if (moduleId === 'finances') finEnabled = !enabled;
				if (moduleId === 'crm') crmEnabled = !enabled;
			}
		} catch {
			moduleMsg = { id: moduleId, ok: false, text: m.fin_module_error() };
			if (moduleId === 'finances') finEnabled = !enabled;
			if (moduleId === 'crm') crmEnabled = !enabled;
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
						disabled={moduleBusy === 'crm'}
						onchange={(v) => setModule('crm', v)}
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
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.card-h {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-bottom: 0.85rem;
	}
	.mod-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--hairline);
	}
	.mod-row:last-of-type {
		border-bottom: none;
	}
	.mod-info {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.mod-label {
		font-size: 0.9rem;
		font-weight: 500;
	}
	.err-msg {
		font-size: 0.8rem;
		color: var(--color-destructive);
		margin-bottom: 0.4rem;
	}
</style>
