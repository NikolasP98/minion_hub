<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		createCredentialHealthState,
		type CredentialProfile
	} from '$lib/state/credential-health.svelte';

	interface Props {
		serverId: string;
	}

	let { serverId }: Props = $props();

	const state = createCredentialHealthState();
	let parsed = $derived(state.parseLatest());

	/** Group profiles by status for the summary row. */
	let statusCounts = $derived.by(() => {
		if (!parsed) return { ok: 0, expiring: 0, expired: 0, static: 0, missing: 0 };
		const counts: Record<string, number> = { ok: 0, expiring: 0, expired: 0, static: 0, missing: 0 };
		for (const p of parsed.providers) {
			counts[p.status] = (counts[p.status] ?? 0) + 1;
		}
		return counts;
	});

	/** Group profiles by provider name. */
	let byProvider = $derived.by(() => {
		if (!parsed) return [] as Array<{ provider: string; profiles: CredentialProfile[] }>;
		const map = new SvelteMap<string, CredentialProfile[]>();
		for (const p of parsed.providers) {
			const list = map.get(p.provider);
			if (list) {
				list.push(p);
			} else {
				map.set(p.provider, [p]);
			}
		}
		return [...map.entries()].map(([provider, profiles]) => ({ provider, profiles }));
	});

	let capturedAgo = $derived.by(() => {
		if (!parsed) return '';
		const diff = Date.now() - parsed.capturedAt;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	});

	function statusColor(status: string): string {
		switch (status) {
			case 'ok':
				return 'var(--green)';
			case 'expiring':
				return 'var(--amber)';
			case 'expired':
				return 'var(--red)';
			case 'static':
			case 'missing':
			default:
				return 'var(--text3)';
		}
	}

	function statusBg(status: string): string {
		switch (status) {
			case 'ok':
				return 'rgba(34, 197, 94, 0.15)';
			case 'expiring':
				return 'rgba(245, 158, 11, 0.15)';
			case 'expired':
				return 'rgba(239, 68, 68, 0.15)';
			case 'static':
			case 'missing':
			default:
				return 'rgba(100, 116, 139, 0.15)';
		}
	}

	onMount(() => {
		state.load(serverId);
		const interval = setInterval(() => state.load(serverId), 60_000);
		return () => clearInterval(interval);
	});
</script>

<div class="panel">
	<div class="panel-header">
		<h3 class="panel-title">Credential Health</h3>
		{#if capturedAgo}
			<span class="panel-meta">{capturedAgo}</span>
		{/if}
	</div>

	{#if state.loading && !parsed}
		<div class="panel-empty">Loading...</div>
	{:else if state.error}
		<div class="panel-empty panel-error">{state.error}</div>
	{:else if !parsed || parsed.providers.length === 0}
		<div class="panel-empty">No credential data</div>
	{:else}
		<div class="status-summary">
			{#each Object.entries(statusCounts) as [status, count] (status)}
				{#if count > 0}
					<span
						class="status-pill"
						style:color={statusColor(status)}
						style:background={statusBg(status)}
						style:border-color={statusColor(status)}
					>
						{count} {status}
					</span>
				{/if}
			{/each}
		</div>

		<div class="provider-list">
			{#each byProvider as group (group.provider)}
				<div class="provider-group">
					<div class="provider-name">{group.provider}</div>
					<div class="profile-cards">
						{#each group.profiles as profile (profile.profileId)}
							<div
								class="profile-card"
								style:border-left-color={statusColor(profile.status)}
							>
								<span class="profile-id" title={profile.profileId}>
									{profile.profileId}
								</span>
								<span
									class="profile-status"
									style:color={statusColor(profile.status)}
								>
									{profile.status}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.panel {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
	}

	.panel-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		margin: 0;
	}

	.panel-meta {
		font-size: 11px;
		color: var(--text3);
	}

	.panel-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 48px 16px;
		color: var(--text3);
		font-size: 13px;
	}

	.panel-error {
		color: var(--red);
	}

	.status-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
	}

	.status-pill {
		font-size: 11px;
		font-weight: 600;
		padding: 3px 10px;
		border-radius: 12px;
		border: 1px solid;
		white-space: nowrap;
	}

	.provider-list {
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.provider-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.provider-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--text2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.profile-cards {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.profile-card {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		background: var(--bg3);
		border: 1px solid var(--border);
		border-left-width: 3px;
		border-radius: 6px;
		font-size: 12px;
		min-width: 0;
	}

	.profile-id {
		color: var(--text);
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.profile-status {
		font-weight: 600;
		font-size: 11px;
		white-space: nowrap;
	}
</style>
