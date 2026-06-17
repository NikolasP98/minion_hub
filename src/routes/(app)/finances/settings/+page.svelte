<script lang="ts">
	import type { PageData } from './$types';
	import { Settings2, RefreshCw, Plug } from 'lucide-svelte';
	import { PageHeader, Button, Toggle } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import { financeSync } from '$lib/state/features/finance-sync.svelte';
	import * as progress from '@zag-js/progress';
	import { useMachine, normalizeProps } from '@zag-js/svelte';
	import { onMount } from 'svelte';

	let { data }: { data: PageData } = $props();

	// ── Connector card ────────────────────────────────────────────────────────
	// svelte-ignore state_referenced_locally
	const src = data.source;
	let businessId = $state(
		// svelte-ignore state_referenced_locally
		typeof (src?.config as Record<string, unknown> | null | undefined)?.businessId === 'number'
			? String((src?.config as Record<string, unknown>).businessId)
			: '',
	);
	// svelte-ignore state_referenced_locally
	const hasCredentials = $state(src?.hasCredentials ?? false);
	let secretUsername = $state('');
	let secretPassword = $state('');
	let connectorEnabled = $state(
		// svelte-ignore state_referenced_locally
		src?.enabled ?? true,
	);
	let connectorBusy = $state(false);
	let connectorMsg = $state<{ ok: boolean; text: string } | null>(null);

	async function saveConnector() {
		connectorBusy = true;
		connectorMsg = null;
		try {
			const res = await fetch('/api/finances/sources', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					provider: 'susii',
					config: { businessId: businessId ? Number(businessId) : null },
					username: secretUsername,
					password: secretPassword,
					enabled: connectorEnabled,
				}),
			});
			connectorMsg = res.ok
				? { ok: true, text: m.fin_connector_saved() }
				: { ok: false, text: m.fin_connector_error() };
		} catch {
			connectorMsg = { ok: false, text: m.fin_connector_error() };
		} finally {
			connectorBusy = false;
		}
	}

	// ── Sync card ─────────────────────────────────────────────────────────────
	const progressSvc = useMachine(progress.machine as any, () => ({
		id: 'fin-sync-progress',
		value: financeSync.total == null ? null : financeSync.processed,
		max: financeSync.total ?? 100,
	}));
	const prog = $derived(progress.connect(progressSvc as progress.Service, normalizeProps));

	onMount(() => {
		financeSync.refresh('susii');
		return () => financeSync.stop();
	});

	function syncStatusLabel(): string {
		switch (financeSync.status) {
			case 'running':
			case 'queued': return m.fin_sync_status_running();
			case 'succeeded': return m.fin_sync_status_succeeded();
			case 'failed': return m.fin_sync_status_failed();
			case 'cancelled': return m.fin_sync_status_cancelled();
			default: return '';
		}
	}
</script>

<svelte:head><title>{m.fin_settings_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.fin_settings_title()} subtitle={m.fin_settings_subtitle()}>
		{#snippet leading()}
			<Settings2 size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4">
		<div class="grid gap-4 max-w-2xl">

			<!-- ── Connector card ─────────────────────────────────────────────── -->
			<section class="card">
				<header class="card-h">
					<Plug size={14} />
					<span>{m.fin_connector_card()}</span>
				</header>

				<div class="field">
					<span class="t-caption">{m.fin_connector_provider()}</span>
					<span class="mono-val">susii</span>
				</div>

				<label class="field">
					<span class="t-caption">{m.fin_connector_business_id()}</span>
					<input
						class="inp"
						type="number"
						min="1"
						bind:value={businessId}
						placeholder={m.fin_connector_business_id_ph()}
					/>
				</label>

				{#if hasCredentials}
					<p class="t-caption cred-hint">{m.fin_connector_credentials_hint()}</p>
				{/if}

				<label class="field">
					<span class="t-caption">{m.fin_connector_secret_username()}</span>
					<input class="inp" type="text" autocomplete="username" bind:value={secretUsername} />
				</label>

				<label class="field">
					<span class="t-caption">{m.fin_connector_secret_password()}</span>
					<input class="inp" type="password" autocomplete="new-password" bind:value={secretPassword} />
				</label>

				<div class="field">
					<Toggle
						bind:checked={connectorEnabled}
						label={m.fin_connector_enabled()}
					/>
				</div>

				{#if src?.lastSyncAt}
					<div class="meta-row">
						<span class="t-caption">{m.fin_connector_last_sync()}</span>
						<span class="mono-val">{new Date(src.lastSyncAt).toLocaleString()}</span>
					</div>
				{/if}
				{#if src?.lastStatus}
					<div class="meta-row">
						<span class="t-caption">{m.fin_connector_last_status()}</span>
						<span class="mono-val">{src.lastStatus}</span>
					</div>
				{/if}
				{#if src?.watermark}
					<div class="meta-row">
						<span class="t-caption">{m.fin_connector_watermark()}</span>
						<span class="mono-val">{src.watermark}</span>
					</div>
				{/if}

				{#if connectorMsg}
					<p class={connectorMsg.ok ? 'ok-msg' : 'err-msg'}>{connectorMsg.text}</p>
				{/if}

				<div class="actions">
					<Button variant="primary" size="sm" onclick={saveConnector} disabled={connectorBusy}>
						{m.fin_connector_save()}
					</Button>
				</div>
			</section>

			<!-- ── Sync card ──────────────────────────────────────────────────── -->
			<section class="card">
				<header class="card-h">
					<RefreshCw size={14} />
					<span>{m.fin_sync_card()}</span>
				</header>

				<p class="t-caption mb-3">{m.fin_sync_description()}</p>

				{#if financeSync.active || financeSync.status}
					<div {...prog.getRootProps()} class="prog">
						<div class="prog-meta">
							<span class="t-caption">{syncStatusLabel()}</span>
							{#if financeSync.total != null}
								<span class="mono-val">{m.fin_sync_progress({ processed: financeSync.processed, total: financeSync.total })} · {financeSync.percent}%</span>
							{:else}
								<span class="mono-val">{financeSync.processed}</span>
							{/if}
						</div>
						<div {...prog.getTrackProps()} class="prog-track">
							<div {...prog.getRangeProps()} class="prog-range" style={financeSync.total != null ? `width:${financeSync.percent}%` : 'width:40%'}></div>
						</div>
					</div>
				{/if}

				{#if financeSync.status === 'failed' && financeSync.error}
					<p class="err-msg">{financeSync.error}</p>
				{/if}

				<div class="actions sync-actions">
					<Button variant="outline" size="sm" onclick={() => financeSync.start('susii')} disabled={financeSync.active}>
						<RefreshCw size={14} class={financeSync.active ? 'animate-spin' : ''} />
						{financeSync.active ? m.fin_sync_running() : m.fin_sync_now()}
					</Button>
					{#if financeSync.active}
						<Button variant="ghost" size="sm" onclick={() => financeSync.cancel('susii')}>{m.fin_sync_cancel()}</Button>
					{/if}
				</div>
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
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.7rem;
	}
	.inp {
		height: 2rem;
		padding: 0 0.6rem;
		font-size: 0.85rem;
		border-radius: var(--radius-md);
		background: var(--color-bg3);
		border: 1px solid var(--hairline);
	}
	.mono-val {
		font-size: 0.82rem;
		font-family: var(--font-mono, monospace);
		color: var(--color-muted-foreground);
	}
	.meta-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.4rem;
		font-size: 0.82rem;
	}
	.meta-row .t-caption {
		min-width: 9rem;
	}
	.actions {
		margin-top: 0.75rem;
	}
	.ok-msg {
		font-size: 0.8rem;
		color: var(--color-success, var(--color-emerald));
		margin-bottom: 0.4rem;
	}
	.err-msg {
		font-size: 0.8rem;
		color: var(--color-destructive);
		margin-bottom: 0.4rem;
	}
	.cred-hint {
		font-size: 0.78rem;
		color: var(--color-muted-foreground);
		margin-bottom: 0.5rem;
		font-style: italic;
	}
	.prog { margin-bottom: 0.75rem; }
	.prog-meta { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.35rem; }
	.prog-track { height: 6px; border-radius: 999px; background: var(--color-bg3); overflow: hidden; }
	.prog-range { height: 100%; background: var(--color-accent); border-radius: 999px; transition: width 0.4s ease; }
	.sync-actions { display: flex; gap: 0.5rem; align-items: center; }
</style>
