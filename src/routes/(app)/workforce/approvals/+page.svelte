<script lang="ts">
	import type { PageData } from './$types';
	import type { ApprovalStatus } from '@minion-stack/paperclip-client';

	let { data }: { data: PageData } = $props();

	const { items } = $derived(data);

	const STATUS_BADGE: Record<ApprovalStatus, string> = {
		pending: 'bg-amber-500/10 text-amber-600',
		revision_requested: 'bg-orange-500/10 text-orange-600',
		resubmitted: 'bg-blue-500/10 text-blue-600',
		approved: 'bg-green-500/10 text-green-600',
		rejected: 'bg-destructive/10 text-destructive',
		cancelled: 'bg-muted text-muted-foreground/50',
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

	function formatCents(payload: Record<string, unknown>): string | null {
		const raw = payload.amountCents ?? payload.amount_cents;
		if (typeof raw !== 'number') return null;
		return `$${(raw / 100).toFixed(2)}`;
	}

	function extractDescription(payload: Record<string, unknown>): string | null {
		const desc = payload.description ?? payload.reason ?? payload.summary;
		return typeof desc === 'string' ? desc : null;
	}
</script>

<div class="p-6 space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">Approvals</h1>
		{#if pendingCount > 0}
			<span class="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-600">
				{pendingCount} pending
			</span>
		{/if}
	</div>

	{#if items.length === 0}
		<div class="rounded-lg border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
			<p class="text-muted-foreground text-sm">No approvals yet.</p>
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

							<!-- Description from payload -->
							{#if extractDescription(approval.payload)}
								<p class="text-sm text-muted-foreground">{extractDescription(approval.payload)}</p>
							{/if}

							<!-- Amount if present in payload -->
							{#if formatCents(approval.payload)}
								<p class="text-sm font-semibold">{formatCents(approval.payload)}</p>
							{/if}

							<!-- Payload fallback for opaque types -->
							{#if !extractDescription(approval.payload) && !formatCents(approval.payload) && Object.keys(approval.payload).length > 0}
								<!-- TODO polish: render payload fields in a human-readable form per approval type -->
								<pre class="text-xs text-muted-foreground whitespace-pre-wrap break-all">{JSON.stringify(approval.payload)}</pre>
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
							<span>Agent: <span class="font-mono">{approval.requestedByAgentId.slice(0, 8)}…</span></span>
						{:else if approval.requestedByUserId}
							<span>User: <span class="font-mono">{approval.requestedByUserId.slice(0, 8)}…</span></span>
						{:else}
							<span>Requester unknown</span>
						{/if}

						{#if approval.decisionNote}
							<span class="ml-2 text-muted-foreground/70">Note: {approval.decisionNote}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
