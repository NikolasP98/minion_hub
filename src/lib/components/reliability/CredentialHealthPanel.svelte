<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { SvelteMap } from 'svelte/reactivity';
	import { KeyRound } from 'lucide-svelte';
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
				return 'var(--color-success)';
			case 'expiring':
				return 'var(--color-warning)';
			case 'expired':
				return 'var(--color-destructive)';
			case 'static':
			case 'missing':
			default:
				return 'var(--color-muted-foreground)';
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

<div class="bg-card border border-border rounded-lg overflow-hidden">
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<KeyRound size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">{m.reliability_credentialTitle()}</span>
		{#if capturedAgo}
			<span class="text-[10px] text-muted-foreground/60">{capturedAgo}</span>
		{/if}
	</div>

	{#if state.loading && !parsed}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.common_loading()}</div>
	{:else if state.error}
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">{state.error}</div>
	{:else if !parsed || parsed.providers.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.reliability_noCredentials()}</div>
	{:else}
		<div class="flex flex-wrap gap-2 py-3 px-4 border-b border-border">
			{#each Object.entries(statusCounts) as [status, count] (status)}
				{#if count > 0}
					<span
						class="text-[11px] font-semibold py-0.5 px-2.5 rounded-xl border whitespace-nowrap"
						style:color={statusColor(status)}
						style:background={statusBg(status)}
						style:border-color={statusColor(status)}
					>
						{count} {status}
					</span>
				{/if}
			{/each}
		</div>

		<div class="py-3 px-4 flex flex-col gap-3">
			{#each byProvider as group (group.provider)}
				<div class="flex flex-col gap-1.5">
					<div class="text-xs font-semibold text-muted uppercase tracking-wider">{group.provider}</div>
					<div class="flex flex-wrap gap-1.5">
						{#each group.profiles as profile (profile.profileId)}
							<div
								class="flex items-center gap-2 py-1.5 px-2.5 bg-bg3 border border-border border-l-[3px] rounded-md text-xs min-w-0"
								style:border-left-color={statusColor(profile.status)}
							>
								<span class="text-foreground max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap" title={profile.profileId}>
									{profile.profileId}
								</span>
								<span
									class="font-semibold text-[11px] whitespace-nowrap"
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
