<script lang="ts">
	import type { PageData } from './$types';
	import type { ApprovalStatus } from '@minion-stack/paperclip-client';
	import * as m from '$lib/paraglide/messages';
	import ApprovalPayload from '$lib/components/workforce/ApprovalPayload.svelte';
	import { PageHeader } from '$lib/components/ui';
	import { ClipboardCheck } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	const { items } = $derived(data);

	const STATUS_BADGE: Record<ApprovalStatus, string> = {
		pending: 'bg-amber-500/10 text-amber-600',
		revision_requested: 'bg-orange-500/10 text-orange-600',
		resubmitted: 'bg-blue-500/10 text-blue-600',
		approved: 'bg-green-500/10 text-green-600',
		rejected: 'bg-destructive/10 text-destructive',
		cancelled: 'bg-muted text-muted-strong',
	};

	const STATUS_LABELS: Record<ApprovalStatus, string> = {
		pending: 'Pending',
		revision_requested: 'Revision',
		resubmitted: 'Resubmitted',
		approved: 'Approved',
		rejected: 'Rejected',
		cancelled: 'Cancelled',
	};

	// Sort newest first
	const sorted = $derived([...items].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	));

	const pendingCount = $derived(
		items.filter((a) => a.status === 'pending' || a.status === 'revision_requested').length
	);

	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function topLineAmount(payload: Record<string, unknown>): string | null {
		const raw = payload.amountCents ?? payload.amount_cents;
		if (typeof raw !== 'number') return null;
		return `$${(raw / 100).toFixed(2)}`;
	}
</script>

<PageHeader title={m.workforce_approvals()}>
	{#snippet leading()}
		<ClipboardCheck size={16} class="text-accent shrink-0" />
	{/snippet}
	{#snippet actions()}
		{#if pendingCount > 0}
			<span class="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-600">
				{pendingCount} {m.approvals_pending()}
			</span>
		{/if}
	{/snippet}
</PageHeader>
<main class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
	{#if items.length === 0}
		<div class="rounded-lg border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
			<p class="text-muted-foreground text-sm">{m.approvals_noApprovalsYet()}</p>
		</div>
	{:else}
		<ul class="space-y-3">
			{#each sorted as approval (approval.id)}
				<li class="rounded-lg border border-border bg-card p-4 space-y-2">
					<div class="flex items-start gap-3">
						<!-- Status badge -->
						<span
							class="shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium {STATUS_BADGE[approval.status]}"
						>
							{STATUS_LABELS[approval.status]}
						</span>

						<div class="min-w-0 flex-1 space-y-1">
							<!-- Type + ID -->
							<p class="text-sm font-medium">
								{approval.type}
								<span class="text-xs font-mono text-muted-foreground ml-1">#{approval.id.slice(0, 8)}</span>
							</p>

							<!-- Amount quick-glance (kept above the structured block) -->
							{#if topLineAmount(approval.payload)}
								<p class="text-sm font-semibold">{topLineAmount(approval.payload)}</p>
							{/if}

							<!-- Type-specific structured renderer (ported from paperclip ApprovalPayload.tsx) -->
							{#if Object.keys(approval.payload).length > 0}
								<ApprovalPayload type={approval.type} payload={approval.payload} />
							{/if}
						</div>

						<!-- Requested at -->
						<time
							class="shrink-0 text-xs text-muted-foreground whitespace-nowrap"
							datetime={new Date(approval.createdAt).toISOString()}
						>
							{formatDate(approval.createdAt)}
						</time>
					</div>

					<!-- Requester info -->
					<div class="flex items-center gap-2 text-xs text-muted-foreground pl-0">
						{#if approval.requestedByAgentId}
							<span>{m.approvals_agent()}: <span class="font-mono">{approval.requestedByAgentId.slice(0, 8)}…</span></span>
						{:else if approval.requestedByUserId}
							<span>{m.approvals_user()}: <span class="font-mono">{approval.requestedByUserId.slice(0, 8)}…</span></span>
						{:else}
							<span>{m.approvals_requesterUnknown()}</span>
						{/if}

						{#if approval.decisionNote}
							<span class="ml-2 text-muted-strong">Note: {approval.decisionNote}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>
