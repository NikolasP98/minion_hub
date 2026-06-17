<script lang="ts">
	import type { PageData } from './$types';
	import { Settings2, RefreshCw, Plug } from 'lucide-svelte';
	import { PageHeader, Button, Toggle } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();

	// ── Connector card ────────────────────────────────────────────────────────
	// svelte-ignore state_referenced_locally
	const src = data.source;
	let businessId = $state(
		// svelte-ignore state_referenced_locally
		typeof (src?.config as Record<string, unknown> | null | undefined)?.businessId === 'number'
			? String((src.config as Record<string, unknown>).businessId)
			: '',
	);
	let secretUsername = $state(
		// svelte-ignore state_referenced_locally
		(src?.secretRefs as Record<string, string> | null | undefined)?.username ?? 'SUSII_USERNAME',
	);
	let secretPassword = $state(
		// svelte-ignore state_referenced_locally
		(src?.secretRefs as Record<string, string> | null | undefined)?.password ?? 'SUSII_PASSWORD',
	);
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
					secretRefs: { username: secretUsername, password: secretPassword },
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
	let syncBusy = $state(false);
	let syncMsg = $state<{ ok: boolean; text: string } | null>(null);

	async function syncNow() {
		syncBusy = true;
		syncMsg = null;
		try {
			const res = await fetch('/api/finances/sync', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ provider: 'susii' }),
			});
			if (res.ok) {
				const r = (await res.json()) as { count?: number; status?: string };
				syncMsg = {
					ok: true,
					text: m.fin_sync_result({ count: r.count ?? 0, status: r.status ?? 'ok' }),
				};
			} else {
				syncMsg = { ok: false, text: m.fin_sync_error() };
			}
		} catch {
			syncMsg = { ok: false, text: m.fin_sync_error() };
		} finally {
			syncBusy = false;
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

				<label class="field">
					<span class="t-caption">{m.fin_connector_secret_username()}</span>
					<input class="inp font-mono" type="text" bind:value={secretUsername} />
				</label>

				<label class="field">
					<span class="t-caption">{m.fin_connector_secret_password()}</span>
					<input class="inp font-mono" type="text" bind:value={secretPassword} />
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

				{#if syncMsg}
					<p class={syncMsg.ok ? 'ok-msg' : 'err-msg'}>{syncMsg.text}</p>
				{/if}

				<div class="actions">
					<Button variant="outline" size="sm" onclick={syncNow} disabled={syncBusy}>
						<RefreshCw size={14} class={syncBusy ? 'animate-spin' : ''} />
						{syncBusy ? m.fin_sync_running() : m.fin_sync_now()}
					</Button>
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
</style>
