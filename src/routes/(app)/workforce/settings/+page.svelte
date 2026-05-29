<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const { company, agentCount } = $derived(data);

	function dollars(cents: number): string {
		return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
	}

	function formatDate(d: Date | string | null): string {
		if (!d) return '—';
		return new Date(d).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
	}

	const utilization = $derived(
		company.budgetMonthlyCents > 0
			? Math.round((company.spentMonthlyCents / company.budgetMonthlyCents) * 100)
			: 0,
	);
</script>

<div class="p-6 space-y-6 max-w-5xl">
	<header>
		<h1 class="text-2xl font-semibold">Workforce settings</h1>
		<p class="text-sm text-muted-foreground mt-1">
			Company-scoped settings for <span class="font-medium text-foreground">{company.name}</span>.
		</p>
	</header>

	<!-- Sub-page nav -->
	<nav class="flex flex-wrap gap-2 text-sm">
		<a href="/workforce/settings" class="rounded-md border border-border bg-card px-3 py-1.5 font-medium">
			General
		</a>
		<a href="/workforce/settings/agents" class="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted transition-colors">
			Agents
			<span class="ml-1 text-xs text-muted-foreground">{agentCount}</span>
		</a>
	</nav>

	<!-- General info card -->
	<section>
		<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
			Company info
		</h2>
		<div class="rounded-lg border border-border bg-card divide-y divide-border text-sm">
			<div class="px-4 py-3 grid grid-cols-[10rem_1fr] gap-3">
				<span class="text-muted-foreground">Name</span>
				<span class="font-medium">{company.name}</span>
			</div>
			{#if company.description}
				<div class="px-4 py-3 grid grid-cols-[10rem_1fr] gap-3">
					<span class="text-muted-foreground">Description</span>
					<span>{company.description}</span>
				</div>
			{/if}
			<div class="px-4 py-3 grid grid-cols-[10rem_1fr] gap-3">
				<span class="text-muted-foreground">Status</span>
				<span class="font-medium">{company.status}</span>
			</div>
			<div class="px-4 py-3 grid grid-cols-[10rem_1fr] gap-3">
				<span class="text-muted-foreground">Issue prefix</span>
				<span class="font-mono text-xs">{company.issuePrefix}-{company.issueCounter}</span>
			</div>
			<div class="px-4 py-3 grid grid-cols-[10rem_1fr] gap-3 items-center">
				<span class="text-muted-foreground">Brand color</span>
				{#if company.brandColor}
					<span class="flex items-center gap-2">
						<span
							class="inline-block size-4 rounded border border-border"
							style="background:{company.brandColor}"
						></span>
						<span class="font-mono text-xs">{company.brandColor}</span>
					</span>
				{:else}
					<span class="text-muted-foreground">—</span>
				{/if}
			</div>
		</div>
	</section>

	<!-- Budget -->
	<section>
		<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
			Budget
		</h2>
		<div class="rounded-lg border border-border bg-card p-4 space-y-3">
			<div class="flex items-baseline justify-between text-sm">
				<span class="text-muted-foreground">This month</span>
				<span class="font-medium">
					{dollars(company.spentMonthlyCents)} <span class="text-muted-foreground">/ {dollars(company.budgetMonthlyCents)}</span>
				</span>
			</div>
			<div class="h-2 rounded-full bg-muted overflow-hidden">
				<div
					class="h-full bg-primary"
					style="width: {Math.min(100, utilization)}%"
				></div>
			</div>
			<div class="text-xs text-muted-foreground">{utilization}% utilization</div>
		</div>
	</section>

	<!-- Policies -->
	<section>
		<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
			Policies
		</h2>
		<div class="rounded-lg border border-border bg-card divide-y divide-border text-sm">
			<div class="px-4 py-3 grid grid-cols-[1fr_auto] gap-3">
				<div>
					<div class="font-medium">Board approval required for new agents</div>
					<div class="text-xs text-muted-foreground mt-0.5">
						When enabled, hiring a new agent requires explicit board sign-off before it can run.
					</div>
				</div>
				<span class="text-xs font-medium px-2 py-1 rounded-md self-start {company.requireBoardApprovalForNewAgents ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}">
					{company.requireBoardApprovalForNewAgents ? 'On' : 'Off'}
				</span>
			</div>
			<div class="px-4 py-3 grid grid-cols-[1fr_auto] gap-3">
				<div>
					<div class="font-medium">Feedback data sharing</div>
					<div class="text-xs text-muted-foreground mt-0.5">
						{#if company.feedbackDataSharingEnabled}
							Sharing anonymized feedback traces with Paperclip Labs.
							{#if company.feedbackDataSharingConsentAt}
								Consented {formatDate(company.feedbackDataSharingConsentAt)}
								{#if company.feedbackDataSharingTermsVersion}
									(terms v{company.feedbackDataSharingTermsVersion}).
								{/if}
							{/if}
						{:else}
							Disabled — no feedback data leaves this company.
						{/if}
					</div>
				</div>
				<span class="text-xs font-medium px-2 py-1 rounded-md self-start {company.feedbackDataSharingEnabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}">
					{company.feedbackDataSharingEnabled ? 'On' : 'Off'}
				</span>
			</div>
		</div>
	</section>

	<!-- Metadata -->
	<section>
		<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
			Metadata
		</h2>
		<div class="rounded-lg border border-border bg-card divide-y divide-border text-sm">
			<div class="px-4 py-3 grid grid-cols-[10rem_1fr] gap-3">
				<span class="text-muted-foreground">Company ID</span>
				<span class="font-mono text-xs">{company.id}</span>
			</div>
			<div class="px-4 py-3 grid grid-cols-[10rem_1fr] gap-3">
				<span class="text-muted-foreground">Created</span>
				<span>{formatDate(company.createdAt)}</span>
			</div>
			<div class="px-4 py-3 grid grid-cols-[10rem_1fr] gap-3">
				<span class="text-muted-foreground">Updated</span>
				<span>{formatDate(company.updatedAt)}</span>
			</div>
		</div>
	</section>
</div>
