<script lang="ts">
	import type { PageData } from './$types';
	import type { IssueStatus } from '@minion-stack/workforce-client';
	import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
	import ApprovalPayload from '$lib/components/workforce/ApprovalPayload.svelte';
	import PipelineStepper from '$lib/components/workforce/PipelineStepper.svelte';

	import { invalidateAll } from '$app/navigation';

	let { data }: { data: PageData } = $props();
	const { issue, comments, documents, workProducts, approvals, children, agentNames } = $derived(data);

	let decisionComment = $state('');
	let decisionBusy = $state(false);
	let decisionError = $state('');

	// The HITL gate: a pending user-participant stage awaiting a disposition.
	const awaitingMyDecision = $derived(
		issue.status === 'in_review' &&
			issue.executionState?.status === 'pending' &&
			issue.executionState.currentParticipant?.type === 'user',
	);

	async function decide(outcome: 'approve' | 'request_changes') {
		if (decisionBusy || !decisionComment.trim()) return;
		decisionBusy = true;
		decisionError = '';
		try {
			const res = await fetch(`/api/workforce/issues/${issue.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					status: outcome === 'approve' ? 'done' : 'in_progress',
					comment: decisionComment.trim(),
				}),
			});
			if (!res.ok) {
				decisionError = `decision failed (${res.status}): ${(await res.text()).slice(0, 200)}`;
				return;
			}
			decisionComment = '';
			await invalidateAll();
		} finally {
			decisionBusy = false;
		}
	}

	const STATUS_LABELS: Record<IssueStatus, string> = {
		in_progress: 'In Progress',
		blocked: 'Blocked',
		todo: 'To Do',
		backlog: 'Backlog',
		in_review: 'In Review',
		done: 'Done',
		cancelled: 'Cancelled',
	};

	const STATUS_BADGE: Record<IssueStatus, string> = {
		in_progress: 'bg-blue-500/10 text-blue-600',
		blocked: 'bg-amber-500/10 text-amber-600',
		todo: 'bg-muted text-muted-foreground',
		backlog: 'bg-muted text-muted-foreground',
		in_review: 'bg-purple-500/10 text-purple-600',
		done: 'bg-green-500/10 text-green-600',
		cancelled: 'bg-muted text-muted-strong',
	};

	const PRIORITY_BADGE: Record<string, string> = {
		critical: 'text-red-500',
		high: 'text-orange-500',
		medium: 'text-yellow-600',
		low: 'text-muted-foreground',
	};

	function actorLabel(agentId: string | null, userId: string | null): string {
		if (agentId) return agentNames[agentId] ?? `${agentId.slice(0, 8)}…`;
		if (userId) return `user:${userId.slice(0, 6)}…`;
		return 'unknown';
	}

	function formatDate(d: Date | string | null): string {
		if (!d) return '—';
		return new Date(d).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	}

	const ancestors = $derived(issue.ancestors ?? []);

	// --- pipeline (executionPolicy stages) -------------------------------
	type StepState = 'done' | 'current' | 'pending';
	type PipelineStep = { key: string; label: string; who: string; state: StepState };

	function principalLabel(p: { type: 'agent' | 'user'; agentId?: string | null; userId?: string | null } | null): string {
		if (!p) return '—';
		return p.type === 'agent' ? actorLabel(p.agentId ?? null, null) : 'You (HITL)';
	}

	const pipeline = $derived.by((): PipelineStep[] => {
		const policy = issue.executionPolicy;
		if (!policy || policy.stages.length === 0) return [];
		const state = issue.executionState ?? null;
		const completed = new Set(state?.completedStageIds ?? []);
		const stageActive = state?.status === 'pending';
		const stageSteps: PipelineStep[] = policy.stages.map((s) => ({
			key: s.id,
			label: s.type === 'review' ? 'Review' : 'Approval',
			who: principalLabel(s.participants[0] ?? null),
			state: completed.has(s.id) ? 'done' : stageActive && state?.currentStageId === s.id ? 'current' : 'pending',
		}));
		const fixWho = state?.returnAssignee
			? principalLabel(state.returnAssignee)
			: actorLabel(issue.assigneeAgentId, issue.assigneeUserId);
		const fixDone = issue.status === 'done' || stageActive || state?.status === 'completed';
		const fix: PipelineStep = {
			key: 'fix',
			label: state?.status === 'changes_requested' ? 'Fix (changes requested)' : 'Fix',
			who: fixWho,
			state: fixDone ? 'done' : 'current',
		};
		const done: PipelineStep = { key: 'done', label: 'Done', who: '', state: issue.status === 'done' ? 'done' : 'pending' };
		return [fix, ...stageSteps, done];
	});

	// --- origin traceability ---------------------------------------------
	const githubOrigin = $derived.by(() => {
		if ((issue.originKind as string | undefined) !== 'github_issue' || !issue.originId) return null;
		const m = /^([^#]+)#(\d+)$/.exec(issue.originId);
		if (!m) return null;
		return { label: issue.originId, url: `https://github.com/${m[1]}/issues/${m[2]}` };
	});

	const workspace = $derived(issue.currentExecutionWorkspace ?? null);
</script>

<div class="p-6 space-y-6 max-w-5xl">
	<!-- Breadcrumb -->
	<nav class="text-sm text-muted-foreground flex flex-wrap items-center gap-1">
		<a href="/workforce/issues" class="hover:text-foreground">Issues</a>
		{#each ancestors as a (a.id)}
			<span>/</span>
			<a href="/workforce/issues/{a.id}" class="hover:text-foreground truncate max-w-[16rem]">
				{#if a.identifier}<span class="font-mono text-xs">{a.identifier}</span>{/if}
				{a.title}
			</a>
		{/each}
		<span>/</span>
		<span class="text-foreground truncate">
			{#if issue.identifier}<span class="font-mono text-xs">{issue.identifier}</span>{/if}
		</span>
	</nav>

	<!-- Header -->
	<header class="space-y-3">
		<div class="flex items-start gap-3">
			<span class="rounded px-2 py-0.5 text-xs font-medium {STATUS_BADGE[issue.status]}">
				{STATUS_LABELS[issue.status]}
			</span>
			{#if issue.identifier}
				<span class="text-xs font-mono text-muted-foreground pt-1">{issue.identifier}</span>
			{/if}
			<span class="text-xs font-medium pt-1 {PRIORITY_BADGE[issue.priority] ?? 'text-muted-foreground'}">
				{issue.priority}
			</span>
		</div>
		<h1 class="text-2xl font-semibold leading-tight">{issue.title}</h1>
		{#if issue.description}
			<div class="text-sm text-foreground/90 leading-relaxed">
				<MarkdownMessage value={issue.description} />
			</div>
		{/if}
	</header>

	<!-- Pipeline (kanban process steps, each owned by its linked agent) -->
	{#if pipeline.length > 0}
		<section class="rounded-lg border border-border bg-card px-4 py-3">
			<h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pipeline</h2>
			<PipelineStepper steps={pipeline} />
			{#if issue.executionState?.lastDecisionOutcome}
				<p class="mt-2 text-xs text-muted-foreground">
					Last gate decision: <span class="font-medium {issue.executionState.lastDecisionOutcome === 'approved' ? 'text-green-600' : 'text-amber-600'}">{issue.executionState.lastDecisionOutcome.replace('_', ' ')}</span>
				</p>
			{/if}
			{#if awaitingMyDecision}
				<div class="mt-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
					<p class="text-xs font-medium text-blue-600">This issue is waiting on your approval.</p>
					<textarea
						class="w-full rounded-md border border-border bg-background p-2 text-sm"
						rows="2"
						placeholder="Decision comment (required)…"
						bind:value={decisionComment}
					></textarea>
					<div class="flex items-center gap-2">
						<button
							class="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
							disabled={decisionBusy || !decisionComment.trim()}
							onclick={() => decide('approve')}
						>Approve → Done</button>
						<button
							class="rounded-md border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-600 disabled:opacity-50"
							disabled={decisionBusy || !decisionComment.trim()}
							onclick={() => decide('request_changes')}
						>Request changes</button>
						{#if decisionError}<span class="text-xs text-red-500">{decisionError}</span>{/if}
					</div>
				</div>
			{/if}
		</section>
	{/if}

	<!-- Two-column layout: main content + properties sidebar -->
	<div class="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6">
		<div class="space-y-6 min-w-0">
			<!-- Sub-issues -->
			<section>
				<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
					Sub-issues <span class="font-medium normal-case tracking-normal text-xs">({children.length})</span>
				</h2>
				{#if children.length === 0}
					<div class="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
						No sub-issues.
					</div>
				{:else}
					<ul class="divide-y divide-border rounded-lg border border-border bg-card">
						{#each children as child (child.id)}
							<li class="px-4 py-2.5 flex items-center gap-3 text-sm">
								<span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium {STATUS_BADGE[child.status]}">
									{STATUS_LABELS[child.status]}
								</span>
								{#if child.identifier}
									<span class="shrink-0 text-xs font-mono text-muted-foreground">{child.identifier}</span>
								{/if}
								<a class="flex-1 min-w-0 truncate font-medium hover:underline" href="/workforce/issues/{child.id}">
									{child.title}
								</a>
								<span class="shrink-0 text-xs {PRIORITY_BADGE[child.priority] ?? 'text-muted-foreground'}">
									{child.priority}
								</span>
								{#if child.assigneeAgentId}
									<span class="shrink-0 text-xs text-muted-foreground truncate max-w-[10rem]">
										{actorLabel(child.assigneeAgentId, child.assigneeUserId)}
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- Documents -->
			<section>
				<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
					Documents <span class="font-medium normal-case tracking-normal text-xs">({documents.length})</span>
				</h2>
				{#if documents.length === 0}
					<div class="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
						No documents.
					</div>
				{:else}
					<ul class="divide-y divide-border rounded-lg border border-border bg-card">
						{#each documents as doc (doc.id)}
							<li class="px-4 py-2.5 text-sm flex items-center gap-3">
								<span class="font-mono text-xs text-muted-foreground shrink-0">{doc.key}</span>
								<span class="flex-1 min-w-0 truncate font-medium">{doc.title ?? doc.key}</span>
								<span class="shrink-0 text-xs text-muted-foreground">rev {doc.latestRevisionNumber}</span>
								<time class="shrink-0 text-xs text-muted-foreground" datetime={new Date(doc.updatedAt).toISOString()}>
									{formatDate(doc.updatedAt)}
								</time>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- Work products -->
			<section>
				<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
					Work products <span class="font-medium normal-case tracking-normal text-xs">({workProducts.length})</span>
				</h2>
				{#if workProducts.length === 0}
					<div class="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
						No work products yet.
					</div>
				{:else}
					<ul class="divide-y divide-border rounded-lg border border-border bg-card">
						{#each workProducts as wp (wp.id)}
							<li class="px-4 py-3 text-sm space-y-1">
								<div class="flex items-center gap-2">
									<span class="font-medium">{wp.title}</span>
									<span class="rounded bg-muted px-1.5 py-0.5 text-xs">{wp.type}</span>
									<span class="text-xs text-muted-foreground">{wp.status}</span>
								</div>
								{#if wp.summary}
									<p class="text-xs text-muted-foreground">{wp.summary}</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- Linked approvals -->
			{#if approvals.length > 0}
				<section>
					<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
						Linked approvals
					</h2>
					<ul class="divide-y divide-border rounded-lg border border-border bg-card">
						{#each approvals as a (a.id)}
							<li class="px-4 py-3 text-sm space-y-1">
								<div class="flex items-center gap-2">
									<span class="font-mono text-xs text-muted-foreground">{a.id}</span>
									<span class="rounded bg-muted px-1.5 py-0.5 text-xs">{a.type}</span>
									<span class="text-xs">{a.status}</span>
								</div>
								{#if a.payload && typeof a.payload === 'object' && Object.keys(a.payload as Record<string, unknown>).length > 0}
									<ApprovalPayload type={a.type} payload={a.payload as Record<string, unknown>} hidePrimaryTitle />
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<!-- Comments -->
			<section>
				<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
					Comments <span class="font-medium normal-case tracking-normal text-xs">({comments.length})</span>
				</h2>
				{#if comments.length === 0}
					<div class="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
						No comments.
					</div>
				{:else}
					<ul class="space-y-3">
						{#each comments as c (c.id)}
							<li class="rounded-lg border border-border bg-card px-4 py-3 text-sm space-y-1.5">
								<div class="flex items-center gap-2 text-xs text-muted-foreground">
									<span class="font-medium text-foreground">{actorLabel(c.authorAgentId, c.authorUserId)}</span>
									<time datetime={new Date(c.createdAt).toISOString()}>{formatDate(c.createdAt)}</time>
								</div>
								<div class="leading-relaxed"><MarkdownMessage value={c.body} /></div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<!-- Properties sidebar -->
		<aside class="space-y-4">
			<div class="rounded-lg border border-border bg-card p-4 space-y-3 text-sm">
				<div>
					<div class="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Assignee</div>
					<div>{actorLabel(issue.assigneeAgentId, issue.assigneeUserId)}</div>
				</div>
				<div>
					<div class="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Created by</div>
					<div>{actorLabel(issue.createdByAgentId, issue.createdByUserId)}</div>
				</div>
				<div>
					<div class="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Created</div>
					<div>{formatDate(issue.createdAt)}</div>
				</div>
				<div>
					<div class="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Updated</div>
					<div>{formatDate(issue.updatedAt)}</div>
				</div>
				{#if issue.startedAt}
					<div>
						<div class="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Started</div>
						<div>{formatDate(issue.startedAt)}</div>
					</div>
				{/if}
				{#if issue.completedAt}
					<div>
						<div class="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Completed</div>
						<div>{formatDate(issue.completedAt)}</div>
					</div>
				{/if}
				{#if issue.executionRunId}
					<div>
						<div class="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Run</div>
						<div class="font-mono text-xs">{issue.executionRunId}</div>
					</div>
				{/if}
			</div>

			<!-- Traceability -->
			{#if githubOrigin || workspace}
				<div class="rounded-lg border border-border bg-card p-4 space-y-3 text-sm">
					<h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Traceability</h2>
					{#if githubOrigin}
						<div>
							<div class="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Origin</div>
							<a class="font-mono text-xs text-blue-600 hover:underline break-all" href={githubOrigin.url} target="_blank" rel="noreferrer">
								{githubOrigin.label}
							</a>
						</div>
					{/if}
					{#if workspace}
						<div>
							<div class="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Workspace</div>
							<div class="space-y-0.5 text-xs">
								<div><span class="text-muted-foreground">status</span> {workspace.status}</div>
								{#if workspace.branchName}
									<div class="font-mono break-all"><span class="text-muted-foreground font-sans">branch</span> {workspace.branchName}</div>
								{/if}
								{#if workspace.baseRef}
									<div class="font-mono"><span class="text-muted-foreground font-sans">base</span> {workspace.baseRef}</div>
								{/if}
								{#if workspace.cwd}
									<div class="font-mono break-all"><span class="text-muted-foreground font-sans">path</span> {workspace.cwd}</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</aside>
	</div>
</div>
