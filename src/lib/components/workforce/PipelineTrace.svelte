<script lang="ts">
	import type { PipelineTrace, PipelineTraceCategory, PipelineTraceEventStatus } from '$lib/workforce/pipeline-trace';
	import * as m from '$lib/paraglide/messages';

	let { trace }: { trace: PipelineTrace } = $props();

	const categoryStyles: Record<PipelineTraceCategory, string> = {
		classifier: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
		routing: 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300',
		handoff: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
		retry: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
		hitl: 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300',
		merge: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
		stage: 'border-border bg-muted text-foreground',
		lifecycle: 'border-border bg-background text-muted-foreground',
	};

	const statusStyles: Record<PipelineTraceEventStatus, string> = {
		queued: 'text-muted-foreground',
		in_progress: 'text-blue-600 dark:text-blue-400',
		done: 'text-green-600 dark:text-green-400',
		blocked: 'text-amber-600 dark:text-amber-400',
		failed: 'text-red-600 dark:text-red-400',
		cancelled: 'text-muted-foreground line-through',
		event: 'text-muted-foreground',
	};

	function categoryLabel(category: PipelineTraceCategory): string {
		switch (category) {
			case 'classifier': return m.workforce_trace_categoryClassifier();
			case 'routing': return m.workforce_trace_categoryRouting();
			case 'handoff': return m.workforce_trace_categoryHandoff();
			case 'retry': return m.workforce_trace_categoryRetry();
			case 'hitl': return m.workforce_trace_categoryHitl();
			case 'merge': return m.workforce_trace_categoryMerge();
			case 'stage': return m.workforce_trace_categoryStage();
			case 'lifecycle': return m.workforce_trace_categoryLifecycle();
		}
	}

	function statusLabel(status: PipelineTraceEventStatus): string {
		switch (status) {
			case 'queued': return m.workforce_trace_statusQueued();
			case 'in_progress': return m.workforce_trace_statusInProgress();
			case 'done': return m.workforce_trace_statusDone();
			case 'blocked': return m.workforce_trace_statusBlocked();
			case 'failed': return m.workforce_trace_statusFailed();
			case 'cancelled': return m.workforce_trace_statusCancelled();
			case 'event': return m.workforce_trace_statusRecorded();
		}
	}

	function runStatusLabel(status: string): string {
		switch (status) {
			case 'pending': return m.workforce_trace_statusQueued();
			case 'active': return m.workforce_trace_statusInProgress();
			case 'blocked': return m.workforce_trace_statusBlocked();
			case 'completed': return m.workforce_trace_statusDone();
			case 'failed': return m.workforce_trace_statusFailed();
			case 'cancelled': return m.workforce_trace_statusCancelled();
			default: return status;
		}
	}

	function outcomeLabel(outcome: 'passed' | 'failed'): string {
		return outcome === 'passed' ? m.workforce_trace_outcomePassed() : m.workforce_trace_outcomeFailed();
	}

	function eventLabel(eventType: string): string {
		switch (eventType) {
			case 'run_created': return m.workforce_trace_eventRunCreated();
			case 'routing_resolved': return m.workforce_trace_eventRoutingResolved();
			case 'stage_created': return m.workforce_trace_eventStageCreated();
			case 'stage_started': return m.workforce_trace_eventStageStarted();
			case 'stage_completed': return m.workforce_trace_eventStageCompleted();
			case 'stage_failed': return m.workforce_trace_eventStageFailed();
			case 'stage_retry_scheduled': return m.workforce_trace_eventRetryScheduled();
			case 'run_blocked': return m.workforce_trace_eventRunBlocked();
			case 'run_completed': return m.workforce_trace_eventRunCompleted();
			case 'run_failed': return m.workforce_trace_eventRunFailed();
			case 'run_cancelled': return m.workforce_trace_eventRunCancelled();
			default: return eventType.replaceAll('_', ' ');
		}
	}

	function formatDate(value: string | null): string {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	}

	function shortId(value: string): string {
		return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
	}

	function runtimeLabel(adapter: string | null, provider: string | null, model: string | null): string | null {
		const runtime = adapter ?? provider;
		if (!runtime && !model) return null;
		return [runtime, model].filter(Boolean).join(' · ');
	}

	function confidencePercent(confidence: number): number {
		return Math.round(confidence <= 1 ? confidence * 100 : confidence);
	}
</script>

<section class="overflow-hidden rounded-lg border border-border bg-card">
	<header class="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
		<div>
			<h2 class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{m.workforce_trace_title()}</h2>
			<p class="mt-1 text-xs text-muted-foreground">{trace.pipelineName ?? m.workforce_trace_defaultPipeline()}</p>
		</div>
		<span class="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
			{runStatusLabel(trace.status)}
		</span>
	</header>

	<div class="grid gap-px bg-border sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
		<div class="bg-card px-4 py-3 text-xs">
			<div class="mb-1 uppercase tracking-wider text-muted-foreground">{m.workforce_trace_origin()}</div>
			<div class="font-mono text-foreground break-all">{trace.sourceOriginId ?? '—'}</div>
			{#if trace.repository}<div class="mt-1 text-muted-foreground">{trace.repository}</div>{/if}
		</div>
		<div class="bg-card px-4 py-3 text-xs">
			<div class="mb-1 uppercase tracking-wider text-muted-foreground">{m.workforce_trace_route()}</div>
			<div class="font-mono text-foreground break-all">{trace.selectedProjectId ?? m.workforce_trace_unresolved()}</div>
			<div class="mt-1 flex flex-wrap gap-x-2 text-muted-foreground">
				{#if trace.resolution}<span>{trace.resolution.replaceAll('_', ' ')}</span>{/if}
				{#if trace.confidence != null}<span>{m.workforce_trace_confidence()}: {confidencePercent(trace.confidence)}%</span>{/if}
			</div>
		</div>
	</div>

	{#if trace.originalLabels.length > 0 || trace.inferredLabels.length > 0}
		<div class="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5 text-[11px]">
			{#each trace.originalLabels as label, index (`original-${index}-${label}`)}
				<span class="rounded border border-border bg-background px-1.5 py-0.5 text-muted-foreground">{label}</span>
			{/each}
			{#each trace.inferredLabels as label, index (`inferred-${index}-${label}`)}
				<span class="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-700 dark:text-cyan-300">+ {label}</span>
			{/each}
		</div>
	{/if}

	<div class="border-t border-border px-4 py-3">
		{#if trace.events.length === 0}
			<p class="text-xs text-muted-foreground">{m.workforce_trace_noEvents()}</p>
		{:else}
			<ol class="ml-2 border-l border-border/80">
				{#each trace.events as event (event.id)}
					{@const runtime = runtimeLabel(event.resolvedAdapterType, event.resolvedProvider, event.resolvedModel)}
					<li class="relative pb-4 pl-5 last:pb-0">
						<span class="absolute -left-[4.5px] top-1.5 size-2 rounded-full border border-card bg-muted-foreground/70"></span>
						<div class="flex min-w-0 flex-wrap items-center gap-1.5">
							<span class="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider {categoryStyles[event.category]}">
								{categoryLabel(event.category)}
							</span>
							<span class="text-xs font-medium text-foreground">{event.stageLabel ?? eventLabel(event.eventType)}</span>
							{#if event.stageLabel}<span class="text-[11px] text-muted-foreground">· {eventLabel(event.eventType)}</span>{/if}
							<span class="ml-auto text-[10px] font-medium uppercase tracking-wider {statusStyles[event.status]}">{statusLabel(event.status)}</span>
						</div>
						<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
							<span>#{event.sequence}</span>
							{#if event.attempt != null}<span>{m.workforce_trace_attempt()} {event.attempt}</span>{/if}
							{#if event.score != null}<span>{m.workforce_trace_score()} {event.score}/{event.maxScore ?? '?'}</span>{/if}
							{#if runtime}
								<span>{m.workforce_trace_runtime()} {runtime}</span>
							{/if}
							{#if event.harnessRevisionId}<span title={event.harnessRevisionId}>{m.workforce_trace_harness()} {shortId(event.harnessRevisionId)}</span>{/if}
							{#if event.childIssueId}
								<a class="text-blue-600 hover:underline dark:text-blue-400" href={`/workforce/issues/${event.childIssueId}`}>
									{m.workforce_trace_childTask()} {shortId(event.childIssueId)}
								</a>
							{/if}
							<time class="ml-auto font-sans" datetime={event.occurredAt ?? undefined}>{formatDate(event.occurredAt)}</time>
						</div>
						{#if event.summary}
							<p class="mt-1.5 rounded border border-border/70 bg-background px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
								{#if event.outcome}
									<span class="mr-1 font-semibold uppercase tracking-wider {event.outcome === 'passed' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}">{outcomeLabel(event.outcome)}</span>
								{/if}
								{event.summary}
							</p>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</section>
