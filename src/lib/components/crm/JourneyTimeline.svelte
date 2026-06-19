<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
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

	// Render as a chat conversation: drop content-less rows (the empty "Activity"
	// noise), group message rows by channel into a single thread each, oldest →
	// newest so it reads like the real chat. Notes/events with text become centred
	// system lines; empty ones are dropped entirely.
	const groups = $derived.by(() => {
		const withBody = rows.filter((r) => (r.body ?? '').trim().length > 0);
		const map = new Map<string, Row[]>();
		for (const r of withBody) {
			const key = r.kind === 'message' && r.channel ? `ch:${r.channel}` : 'note';
			(map.get(key) ?? map.set(key, []).get(key)!).push(r);
		}
		const out = [...map.entries()].map(([key, items]) => {
			// Chronological ascending — conversation order.
			items.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
			return {
				key,
				channel: key.startsWith('ch:') ? key.slice(3) : null,
				items,
				last: Date.parse(items[items.length - 1]?.occurred_at ?? '') || 0
			};
		});
		// Most-recently-active channel first.
		out.sort((a, b) => b.last - a.last);
		return out;
	});

	const totalShown = $derived(groups.reduce((n, g) => n + g.items.length, 0));
</script>

{#if totalShown === 0}
	<p class="t-caption px-1 py-4">{m.crm_no_interactions()}</p>
{:else}
	<div class="journey">
		{#each groups as g (g.key)}
			<section class="grp">
				<header class="grp-h">
					{#if g.channel}
						<ChannelBrandIcon channel={g.channel} size={14} />
						<span class="grp-name">{g.channel}</span>
					{:else}
						<span class="grp-name">{m.crm_activity()}</span>
					{/if}
					<span class="grp-count">{g.items.length}</span>
				</header>

				{#if g.channel}
					<ol class="thread">
						{#each g.items as r (r.source_id)}
							<li class="row" class:out={r.direction === 'outbound'}>
								<div class="bubble">
									<p class="text">{r.body}</p>
									<span class="time">{relativeTime(r.occurred_at)}</span>
								</div>
							</li>
						{/each}
					</ol>
				{:else}
					<ul class="notes">
						{#each g.items as r (r.source_id)}
							<li class="note">
								<span class="note-text">{r.body}</span>
								<span class="time">{relativeTime(r.occurred_at)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</div>
{/if}

<style>
	.journey {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.grp-h {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		position: sticky;
		top: 0;
		background: var(--color-card);
		padding: 0.2rem 0 0.4rem;
		z-index: 1;
		color: var(--color-muted-foreground);
	}
	.grp-name {
		font-weight: 600;
		font-size: 0.78rem;
		text-transform: capitalize;
		letter-spacing: 0.02em;
	}
	.grp-count {
		margin-left: auto;
		font-size: 0.64rem;
		color: var(--color-muted-foreground);
		background: var(--color-muted);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
	}

	/* Chat thread — inbound left, outbound right, no per-message icons. */
	.thread {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		justify-content: flex-start;
	}
	.row.out {
		justify-content: flex-end;
	}
	.bubble {
		position: relative;
		max-width: 80%;
		padding: 0.38rem 0.6rem 0.34rem;
		border-radius: 0.85rem;
		background: var(--color-muted);
		color: var(--color-foreground);
		border-bottom-left-radius: 0.2rem;
	}
	.row.out .bubble {
		background: color-mix(in srgb, var(--color-emerald, var(--color-success)) 22%, var(--color-card));
		border-bottom-left-radius: 0.85rem;
		border-bottom-right-radius: 0.2rem;
	}
	.text {
		font-size: 0.84rem;
		line-height: 1.3;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		margin: 0;
	}
	.time {
		display: block;
		text-align: right;
		font-size: 0.62rem;
		color: var(--color-muted-foreground);
		margin-top: 0.1rem;
	}

	/* Notes / events — centred system lines (only when they have text). */
	.notes {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.note {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		justify-content: center;
		text-align: center;
		font-size: 0.76rem;
		color: var(--color-muted-foreground);
	}
	.note-text {
		overflow-wrap: anywhere;
	}
	.note .time {
		display: inline;
		margin: 0;
	}
</style>
