<script lang="ts">
	// Reusable activity timeline — comments + field-audit, merged chronologically.
	// Works for any record: pass the loaded `items` + an `onComment` callback.
	import type { TimelineItem } from '$server/services/activity.service';
	import { MessageSquare, GitCommit } from 'lucide-svelte';
	import { Button } from '$lib/components/ui';
	import { relativeTime } from '$lib/components/crm/crm-format';

	let { items, onComment }: { items: TimelineItem[]; onComment: (body: string) => Promise<void> | void } = $props();

	let draft = $state('');
	let busy = $state(false);

	async function submit() {
		const body = draft.trim();
		if (!body) return;
		busy = true;
		try {
			await onComment(body);
			draft = '';
		} finally {
			busy = false;
		}
	}

	function changeText(changes: TimelineItem['changes']): string {
		return (changes ?? [])
			.slice(0, 3)
			.map((c) => `${c.label}: ${c.old ?? '—'} → ${c.new ?? '—'}`)
			.join(', ');
	}
</script>

<div class="timeline">
	<div class="composer">
		<input
			class="inp"
			bind:value={draft}
			placeholder="Add a comment…"
			onkeydown={(e) => e.key === 'Enter' && submit()}
		/>
		<Button variant="secondary" size="sm" onclick={submit} disabled={busy || !draft.trim()}>Comment</Button>
	</div>

	<ol class="feed">
		{#each items as it (it.id)}
			<li class="item" class:audit={it.src === 'audit'}>
				{#if it.src === 'comment'}
					<MessageSquare size={13} class="ic" />
					<div class="bubble">
						<div class="meta"><span class="who">{it.actorName ?? 'System'}</span><span class="ts">{relativeTime(it.ts)}</span></div>
						<p class="body">{it.body}</p>
					</div>
				{:else}
					<GitCommit size={12} class="ic muted" />
					<span class="audit-line">
						<strong>{it.actorName ?? 'System'}</strong> {changeText(it.changes)}
						<span class="ts">· {relativeTime(it.ts)}</span>
					</span>
				{/if}
			</li>
		{:else}
			<li class="t-caption empty">No activity yet.</li>
		{/each}
	</ol>
</div>

<style>
	.composer { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
	.inp { flex: 1; height: 2rem; padding: 0 0.6rem; font-size: 0.86rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); }
	.feed { display: flex; flex-direction: column; gap: 0.6rem; }
	.item { display: flex; gap: 0.5rem; align-items: flex-start; }
	.item :global(.ic) { margin-top: 0.15rem; color: var(--color-muted-foreground); flex-shrink: 0; }
	.item :global(.ic.muted) { opacity: 0.6; }
	.bubble { flex: 1; min-width: 0; }
	.meta { display: flex; gap: 0.5rem; align-items: baseline; }
	.who { font-size: 0.82rem; font-weight: 600; }
	.ts { font-size: 0.72rem; color: var(--color-muted-foreground); }
	.body { font-size: 0.88rem; white-space: pre-wrap; margin-top: 0.1rem; }
	.audit-line { font-size: 0.8rem; color: var(--color-muted-foreground); }
	.audit-line strong { color: var(--color-foreground); font-weight: 600; }
	.empty { padding: 0.5rem 0; }
</style>
