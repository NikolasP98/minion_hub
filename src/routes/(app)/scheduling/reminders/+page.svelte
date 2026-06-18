<script lang="ts">
	import type { PageData } from './$types';
	import { BellRing, Check, X, MinusCircle } from 'lucide-svelte';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Card, Button, Toggle, EmptyState, Badge } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let enabled = $state(data.config?.enabled ?? false);
	// svelte-ignore state_referenced_locally
	let personalize = $state(data.config?.personalize ?? true);
	// svelte-ignore state_referenced_locally
	let accountId = $state(data.config?.accountId ?? '');
	// svelte-ignore state_referenced_locally
	let fromName = $state(data.config?.fromName ?? '');
	let saving = $state(false);
	let saved = $state(false);

	const counts = $derived(data.activity?.counts ?? { sent: 0, failed: 0, skipped: 0 });
	const recent = $derived(data.activity?.recent ?? []);

	const STAGE_LABEL: Record<string, () => string> = {
		confirmation: () => m.sched_rem_stage_confirmation(),
		'24h': () => m.sched_rem_stage_24h(),
		'2h': () => m.sched_rem_stage_2h(),
	};
	const stageLabel = (k: string) => (STAGE_LABEL[k] ?? (() => k))();

	function fmt(iso: string): string {
		return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	async function save() {
		saving = true;
		saved = false;
		try {
			const res = await fetch('/api/scheduling/reminders/config', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ enabled, personalize, accountId: accountId || null, fromName: fromName || null }),
			});
			if (res.ok) {
				saved = true;
				await invalidate('scheduling:data');
			}
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>{m.sched_rem_title()} · {m.nav_scheduling()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.sched_rem_title()} subtitle={m.sched_rem_subtitle()}>
		{#snippet leading()}
			<BellRing size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-3xl">
		<!-- Autonomy summary + enable -->
		<Card padding="lg">
			<p class="text-sm text-[var(--color-muted-foreground)]">{m.sched_rem_autonomy()}</p>
			<div class="mt-4 flex items-center justify-between gap-4 pt-3 border-t border-[var(--hairline)]">
				<div>
					<div class="font-medium">{m.sched_rem_enabled()}</div>
					<div class="t-caption">{m.sched_rem_enabled_desc()}</div>
				</div>
				<Toggle bind:checked={enabled} size="md" />
			</div>
			{#if enabled && !accountId}
				<p class="t-caption mt-2" style="color:var(--color-destructive)">{m.sched_rem_needs_account()}</p>
			{/if}
		</Card>

		<!-- Stages -->
		<Card padding="lg">
			<div class="t-label mb-2">{m.sched_rem_stages()}</div>
			<div class="flex flex-wrap gap-2">
				<Badge>{m.sched_rem_stage_confirmation()}</Badge>
				<Badge>{m.sched_rem_stage_24h()}</Badge>
				<Badge>{m.sched_rem_stage_2h()}</Badge>
			</div>
		</Card>

		<!-- Config -->
		<Card padding="lg">
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
				<label class="field">
					<span class="t-caption">{m.sched_rem_account()}</span>
					<input class="txt" bind:value={accountId} placeholder="default" />
					<span class="t-caption">{m.sched_rem_account_help()}</span>
				</label>
				<label class="field">
					<span class="t-caption">{m.sched_rem_fromName()}</span>
					<input class="txt" bind:value={fromName} placeholder="FACES" />
					<span class="t-caption">{m.sched_rem_fromName_help()}</span>
				</label>
			</div>
			<div class="mt-3 flex items-center justify-between gap-4">
				<div>
					<div class="font-medium text-sm">{m.sched_rem_personalize()}</div>
					<div class="t-caption">{m.sched_rem_personalize_desc()}</div>
				</div>
				<Toggle bind:checked={personalize} size="sm" />
			</div>
			<div class="flex items-center gap-2 mt-4">
				<Button onclick={save} disabled={saving}>{m.sched_rem_save()}</Button>
				{#if saved}<span class="t-caption text-accent">✓ {m.sched_rem_saved()}</span>{/if}
			</div>
		</Card>

		<!-- Status + activity -->
		<Card padding="lg">
			<div class="flex items-center gap-4 mb-3">
				<div class="t-label">{m.sched_rem_activity()}</div>
				<span class="t-caption">· {m.sched_rem_stat_window()}</span>
				<div class="flex-1"></div>
				<span class="stat"><Check size={13} /> {counts.sent}</span>
				<span class="stat"><X size={13} /> {counts.failed}</span>
				<span class="stat"><MinusCircle size={13} /> {counts.skipped}</span>
			</div>
			{#if recent.length === 0}
				<EmptyState title={m.sched_rem_empty_activity()} compact />
			{:else}
				<div class="flex flex-col">
					{#each recent as r (r.id)}
						<div class="row">
							<span class="row-stage">{stageLabel(r.stage)}</span>
							<span class="flex-1 truncate">{r.serviceTitle ?? '—'}</span>
							<span class="t-caption truncate">{r.recipient ?? ''}</span>
							<Badge>{r.status}</Badge>
							<span class="t-caption">{fmt(r.createdAt)}</span>
						</div>
					{/each}
				</div>
			{/if}
		</Card>
	</div>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.txt {
		border: 1px solid var(--hairline);
		border-radius: 8px;
		padding: 0.4rem 0.5rem;
		background: var(--color-card);
		font-size: 0.875rem;
		width: 100%;
	}
	.stat {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-muted-foreground);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--hairline);
		font-size: 0.85rem;
	}
	.row:last-child {
		border-bottom: none;
	}
	.row-stage {
		min-width: 150px;
		font-weight: 500;
	}
</style>
