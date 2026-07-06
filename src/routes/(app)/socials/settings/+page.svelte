<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import { Settings2, Plug, RefreshCw, AlertTriangle } from 'lucide-svelte';
	import { PageHeader, Button, EmptyState, Toggle } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import { canAct } from '$lib/access/can.svelte';
	import { toastSuccess, toastError } from '$lib/state/ui/toast.svelte';
	import DataTable from '$lib/components/data-table/DataTable.svelte';
	import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';

	let { data }: { data: PageData } = $props();
	type Job = (typeof data.jobs)[number];

	const canManage = $derived(canAct('ads', 'manage'));

	onMount(() => {
		const qp = page.url.searchParams;
		const connected = qp.get('connected');
		if (connected === '1') toastSuccess(m.ads_toast_connected());
		else if (connected === '0') toastError(m.ads_toast_connect_error({ reason: qp.get('reason') ?? '—' }));
	});

	function statusLabel(status: string): string {
		switch (status) {
			case 'active': return m.ads_status_active();
			case 'expiring': return m.ads_status_expiring();
			case 'expired': return m.ads_status_expired();
			case 'revoked': return m.ads_status_revoked();
			default: return status;
		}
	}
	function assetKindLabel(kind: string): string {
		switch (kind) {
			case 'page': return m.ads_asset_kind_page();
			case 'ig': return m.ads_asset_kind_ig();
			case 'ad_account': return m.ads_asset_kind_ad_account();
			default: return kind;
		}
	}

	// Two fixed connection kinds (spec 2026-07-05 §8): FLB (Facebook Login for
	// Business, `kind: 'flb'`) and Instagram Login (`kind: 'ig_login'`). Only
	// ever 2 kinds exist — duplicating the small card block per spec's own
	// recommendation rather than building a generic N-connections list.
	const fbConn = $derived(data.connections.find((c) => c.kind === 'flb'));
	const igConn = $derived(data.connections.find((c) => c.kind === 'ig_login'));
	const igAsset = $derived(igConn ? data.assets.find((a) => a.connectionId === igConn.id) : undefined);

	let disconnectingId = $state<string | null>(null);
	async function disconnectConnection(id: string) {
		if (!confirm(m.ads_disconnect_confirm())) return;
		disconnectingId = id;
		try {
			const res = await fetch(`/api/meta/connections/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(`${res.status}`);
			toastSuccess(m.ads_toast_disconnected());
			await invalidate('ads:settings');
		} catch {
			toastError(m.ads_toast_disconnect_error());
		} finally {
			disconnectingId = null;
		}
	}

	let togglingIds = $state<Set<string>>(new Set());
	async function toggleAsset(id: string, enabled: boolean) {
		togglingIds = new Set(togglingIds).add(id);
		try {
			const res = await fetch(`/api/meta/assets/${id}/toggle`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ enabled }),
			});
			if (!res.ok) throw new Error(`${res.status}`);
			await invalidate('ads:settings');
		} catch {
			toastError(m.ads_toast_toggle_error());
			await invalidate('ads:settings');
		} finally {
			const next = new Set(togglingIds);
			next.delete(id);
			togglingIds = next;
		}
	}

	let syncing = $state(false);
	async function syncNow() {
		syncing = true;
		try {
			const res = await fetch('/api/meta/sync/run', { method: 'POST' });
			if (!res.ok) throw new Error(`${res.status}`);
			toastSuccess(m.ads_toast_sync_started());
			await invalidate('ads:settings');
		} catch {
			toastError(m.ads_toast_sync_error());
		} finally {
			syncing = false;
		}
	}

	function fmtDate(d: string | null): string {
		return d ? new Date(d).toLocaleString() : '—';
	}
	function countsSummary(counts: Record<string, unknown>): string {
		const entries = Object.entries(counts);
		if (entries.length === 0) return '—';
		return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
	}

	const dateOf = (d: string | null) => (d ? new Date(d).getTime() : -Infinity);
	const jobColumns: DataColumn<Job>[] = [
		{ key: 'kind', label: m.ads_sync_col_kind() },
		{ key: 'status', label: m.ads_sync_col_status(), custom: true, accessor: (j) => j.status },
		{ key: 'counts', label: m.ads_sync_col_counts(), custom: true, accessor: (j) => countsSummary(j.counts), sortable: false },
		{ key: 'error', label: m.ads_sync_col_error(), custom: true, accessor: (j) => j.error ?? '' },
		{ key: 'finished', label: m.ads_sync_col_finished(), custom: true, accessor: (j) => j.finishedAt, sortFn: (a, b) => dateOf(a.finishedAt) - dateOf(b.finishedAt), exportValue: (j) => (j.finishedAt ? new Date(j.finishedAt).toISOString().slice(0, 10) : '') },
	];
</script>

<svelte:head><title>{m.ads_settings_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.ads_settings_title()} subtitle={m.ads_settings_subtitle()}>
		{#snippet leading()}<Settings2 size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4">
		<div class="grid gap-4 max-w-2xl">
			<!-- ── Facebook connection card ────────────────────────────────── -->
			<section class="card">
				<header class="card-h">
					<Plug size={14} />
					<span>{m.ads_connection_card_facebook()}</span>
				</header>

				{#if fbConn}
					<div class="conn-row">
						<div class="meta-row">
							<span class="t-caption">{m.ads_connection_status()}</span>
							<span class="status-pill" data-status={fbConn.status}>{statusLabel(fbConn.status)}</span>
						</div>
						{#if fbConn.grantedScopes.length > 0}
							<div class="meta-row">
								<span class="t-caption">{m.ads_connection_scopes()}</span>
								<span class="scopes">
									{#each fbConn.grantedScopes as scope (scope)}<span class="scope-chip">{scope}</span>{/each}
								</span>
							</div>
						{/if}
						<div class="meta-row">
							<span class="t-caption">{m.ads_connection_connected_date()}</span>
							<span class="mono-val">{fmtDate(fbConn.createdAt)}</span>
						</div>

						{#if fbConn.status !== 'active'}
							<div class="reconnect-banner">
								<AlertTriangle size={14} />
								<span>{m.ads_reconnect_needed()}</span>
								<Button variant="outline" size="sm" href="/api/meta/oauth/start" disabled={!canManage} title={canManage ? undefined : m.no_permission()}>
									{m.ads_reconnect_button()}
								</Button>
							</div>
						{/if}
					</div>
				{:else}
					<EmptyState compact icon={Plug} title={m.ads_connect_meta()} description={m.ads_connect_meta_desc()}>
						{#snippet action()}
							<Button variant="primary" size="sm" href="/api/meta/oauth/start" disabled={!canManage} title={canManage ? undefined : m.no_permission()}>
								{m.ads_connect_meta()}
							</Button>
						{/snippet}
					</EmptyState>
				{/if}
			</section>

			<!-- ── Instagram connection card ───────────────────────────────── -->
			<section class="card">
				<header class="card-h">
					<Plug size={14} />
					<span>{m.ads_connection_card_instagram()}</span>
				</header>

				{#if igConn}
					<div class="conn-row">
						<div class="meta-row">
							<span class="t-caption">{m.ads_connection_status()}</span>
							<span class="status-pill" data-status={igConn.status}>{statusLabel(igConn.status)}</span>
						</div>
						<div class="meta-row">
							<span class="t-caption">{m.ads_ig_account()}</span>
							<span class="mono-val">{igAsset?.name ?? igAsset?.externalId ?? '—'}</span>
						</div>
						<div class="meta-row">
							<span class="t-caption">{m.ads_connection_connected_date()}</span>
							<span class="mono-val">{fmtDate(igConn.createdAt)}</span>
						</div>

						{#if igConn.status !== 'active'}
							<div class="reconnect-banner">
								<AlertTriangle size={14} />
								<span>{m.ads_reconnect_needed()}</span>
								<Button variant="outline" size="sm" href="/api/meta/ig/start" disabled={!canManage} title={canManage ? undefined : m.no_permission()}>
									{m.ads_reconnect_button()}
								</Button>
							</div>
						{/if}

						<div class="actions mt-2">
							<Button
								variant="danger"
								size="sm"
								onclick={() => disconnectConnection(igConn.id)}
								disabled={!canManage || disconnectingId === igConn.id}
								title={canManage ? undefined : m.no_permission()}
							>
								{m.ads_disconnect_button()}
							</Button>
						</div>
					</div>
				{:else}
					<EmptyState compact icon={Plug} title={m.ads_connect_instagram()} description={m.ads_connect_instagram_desc()}>
						{#snippet action()}
							<Button variant="primary" size="sm" href="/api/meta/ig/start" disabled={!canManage} title={canManage ? undefined : m.no_permission()}>
								{m.ads_connect_instagram()}
							</Button>
						{/snippet}
					</EmptyState>
				{/if}
			</section>

			<!-- ── Assets card ────────────────────────────────────────────────── -->
			<section class="card">
				<header class="card-h">
					<Settings2 size={14} />
					<span>{m.ads_assets_card()}</span>
				</header>

				{#if data.assets.length === 0}
					<p class="t-caption">{m.ads_assets_empty()}</p>
				{:else}
					<ul class="asset-list">
						{#each data.assets as asset (asset.id)}
							<li class="asset-row">
								<span class="asset-kind">{assetKindLabel(asset.kind)}</span>
								<span class="asset-name truncate">{asset.name ?? asset.externalId}</span>
								<Toggle
									checked={asset.enabled}
									disabled={!canManage || togglingIds.has(asset.id)}
									label={asset.name ?? asset.externalId}
									onchange={(checked) => toggleAsset(asset.id, checked)}
								/>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── Sync card ──────────────────────────────────────────────────── -->
			<section class="card">
				<header class="card-h">
					<RefreshCw size={14} />
					<span>{m.ads_sync_card()}</span>
				</header>

				<div class="actions">
					<Button
						variant="outline"
						size="sm"
						onclick={syncNow}
						disabled={syncing || !canManage}
						title={canManage ? undefined : m.no_permission()}
					>
						<RefreshCw size={14} class={syncing ? 'animate-spin' : ''} />
						{syncing ? m.ads_sync_running() : m.ads_sync_now()}
					</Button>
				</div>

				{#if data.jobs.length === 0}
					<p class="t-caption mt-3">{m.ads_sync_history_empty()}</p>
				{:else}
					<div class="job-dt mt-3">
						<DataTable
							class="flex-1 min-h-0"
							columns={jobColumns}
							data={data.jobs}
							getRowId={(j) => j.id}
							searchFields={(j) => `${j.kind} ${j.status} ${j.error ?? ''}`}
							initialSort={{ key: 'finished', dir: 'desc' }}
							exportable
							exportName="ads-sync-history"
							storageKey="ads-settings"
							emptyMessage={m.ads_sync_history_empty()}
						>
							{#snippet cell(job: Job, col: DataColumn<Job>)}
								{#if col.key === 'status'}
									<span class="status-pill" data-status={job.status}>{job.status}</span>
								{:else if col.key === 'counts'}
									<span class="t-caption">{countsSummary(job.counts)}</span>
								{:else if col.key === 'error'}
									<span class="t-caption err-text">{job.error ?? '—'}</span>
								{:else if col.key === 'finished'}
									<span class="t-caption">{fmtDate(job.finishedAt)}</span>
								{/if}
							{/snippet}
						</DataTable>
					</div>
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
	.mono-val {
		font-size: 0.82rem;
		font-family: var(--font-mono, monospace);
		color: var(--color-muted-foreground);
	}
	.scopes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.scope-chip {
		font-size: 0.7rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-muted-foreground) 12%, transparent);
		color: var(--color-muted-foreground);
	}
	.status-pill {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.74rem;
		font-weight: 500;
		text-transform: capitalize;
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.status-pill[data-status='active'],
	.status-pill[data-status='succeeded'] {
		background: color-mix(in srgb, var(--color-success, #22c55e) 15%, transparent);
		color: var(--color-success, #22c55e);
	}
	.status-pill[data-status='expiring'],
	.status-pill[data-status='running'],
	.status-pill[data-status='queued'] {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent);
		color: var(--color-warning, #f59e0b);
	}
	.status-pill[data-status='expired'],
	.status-pill[data-status='revoked'],
	.status-pill[data-status='failed'] {
		background: color-mix(in srgb, var(--color-destructive, #ef4444) 12%, transparent);
		color: var(--color-destructive, #ef4444);
	}
	.reconnect-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.6rem;
		padding: 0.5rem 0.7rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent);
		color: var(--color-warning, #f59e0b);
		font-size: 0.82rem;
	}
	.reconnect-banner span {
		flex: 1;
	}
	.asset-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.asset-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--hairline);
	}
	.asset-row:last-child {
		border-bottom: none;
	}
	.asset-kind {
		flex-shrink: 0;
		font-size: 0.7rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.asset-name {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
	}
	.actions {
		margin-bottom: 0.25rem;
	}
	.err-text {
		color: var(--color-destructive, #ef4444);
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* DataTable owns h-full; give it a bounded height inside the scrolling card column. */
	.job-dt {
		display: flex;
		height: 22rem;
	}
</style>
