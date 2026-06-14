<script lang="ts">
	import { MessageSquare, StickyNote, ArrowRightLeft, Tag } from 'lucide-svelte';
	import { relativeTime } from './crm-format';

	type Row = {
		kind: string;
		direction?: string | null;
		channel?: string | null;
		body?: string | null;
		occurred_at: string;
		source_id: string;
	};
	let { rows }: { rows: Row[] } = $props();

	function icon(kind: string) {
		if (kind === 'note') return StickyNote;
		if (kind === 'stage') return ArrowRightLeft;
		if (kind === 'tag_change') return Tag;
		return MessageSquare;
	}
</script>

{#if rows.length === 0}
	<p class="t-caption px-1 py-4">No interactions yet.</p>
{:else}
	<ol class="timeline">
		{#each rows as r (r.source_id)}
			{@const Icon = icon(r.kind)}
			<li class="row" class:outbound={r.kind === 'message' && r.direction === 'outbound'}>
				<div class="gutter">
					<span class="ico"><Icon size={13} /></span>
				</div>
				<div class="body">
					<div class="meta">
						{#if r.kind === 'message'}
							<span class="chan">{r.channel ?? 'message'}</span>
							<span class="dir">{r.direction === 'inbound' ? '← in' : '→ out'}</span>
						{:else}
							<span class="chan">{r.kind}</span>
						{/if}
						<span class="time">{relativeTime(r.occurred_at)}</span>
					</div>
					{#if r.body}<p class="text">{r.body}</p>{/if}
				</div>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.timeline {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.row {
		display: grid;
		grid-template-columns: 28px 1fr;
		gap: 0.5rem;
		padding: 0.35rem 0;
	}
	.gutter {
		display: flex;
		justify-content: center;
	}
	.ico {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}
	.row.outbound .ico {
		background: color-mix(in srgb, var(--color-muted-foreground) 18%, transparent);
		color: var(--color-muted-foreground);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.7rem;
		color: var(--color-muted-foreground);
	}
	.chan {
		font-weight: 600;
		text-transform: capitalize;
		color: var(--color-foreground);
	}
	.text {
		font-size: 0.84rem;
		margin-top: 0.1rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
