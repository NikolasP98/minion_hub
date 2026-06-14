<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { StickyNote, ArrowDownLeft, ArrowUpRight } from 'lucide-svelte';
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

	// Group messages by channel; non-message events (notes/etc) go to an "Activity"
	// group. Groups are ordered by their most-recent entry; within a group, newest
	// first. (Most-recent channel surfaces at the top.)
	const groups = $derived.by(() => {
		const map = new Map<string, Row[]>();
		for (const r of rows) {
			const key = r.kind === 'message' && r.channel ? `ch:${r.channel}` : 'activity';
			(map.get(key) ?? map.set(key, []).get(key)!).push(r);
		}
		const out = [...map.entries()].map(([key, items]) => {
			items.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
			return {
				key,
				channel: key.startsWith('ch:') ? key.slice(3) : null,
				items,
				last: Date.parse(items[0]?.occurred_at ?? '') || 0,
			};
		});
		out.sort((a, b) => b.last - a.last);
		return out;
	});
</script>

{#if rows.length === 0}
	<p class="t-caption px-1 py-4">{m.crm_no_interactions()}</p>
{:else}
	<div class="journey">
		{#each groups as g (g.key)}
			<section class="grp">
				<header class="grp-h">
					{#if g.channel}
						<ChannelBrandIcon channel={g.channel} size={15} />
						<span class="grp-name">{g.channel}</span>
					{:else}
						<StickyNote size={14} />
						<span class="grp-name">{m.crm_activity()}</span>
					{/if}
					<span class="grp-count">{g.items.length}</span>
				</header>
				<ol class="msgs">
					{#each g.items as r (r.source_id)}
						<li class="msg" class:out={r.kind === 'message' && r.direction === 'outbound'}>
							<span class="dir" aria-hidden="true">
								{#if r.kind !== 'message'}<StickyNote size={11} />
								{:else if r.direction === 'inbound'}<ArrowDownLeft size={12} />
								{:else}<ArrowUpRight size={12} />{/if}
							</span>
							<div class="bubble">
								{#if r.body}<p class="text">{r.body}</p>{/if}
								<span class="time">{relativeTime(r.occurred_at)}</span>
							</div>
						</li>
					{/each}
				</ol>
			</section>
		{/each}
	</div>
{/if}

<style>
	.journey { display: flex; flex-direction: column; gap: 0.9rem; }
	.grp-h {
		display: flex; align-items: center; gap: 0.4rem; position: sticky; top: 0;
		background: var(--color-card); padding: 0.2rem 0; z-index: 1;
		color: var(--color-foreground);
	}
	.grp-name { font-weight: 600; font-size: 0.82rem; text-transform: capitalize; }
	.grp-count {
		margin-left: auto; font-size: 0.66rem; color: var(--color-muted-foreground);
		background: var(--color-muted); border-radius: 999px; padding: 0.05rem 0.45rem;
	}
	.msgs { display: flex; flex-direction: column; gap: 0.3rem; padding-left: 0.1rem; }
	.msg { display: grid; grid-template-columns: 20px 1fr; gap: 0.45rem; align-items: start; }
	.dir { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 999px;
		background: color-mix(in srgb, var(--color-emerald, var(--color-success)) 16%, transparent);
		color: var(--color-emerald, var(--color-success)); margin-top: 0.1rem; }
	.msg.out .dir { background: color-mix(in srgb, var(--color-muted-foreground) 18%, transparent); color: var(--color-muted-foreground); }
	.bubble { min-width: 0; }
	.msg.out .bubble { opacity: 0.82; }
	.text { font-size: 0.84rem; white-space: pre-wrap; overflow-wrap: anywhere; }
	.time { font-size: 0.66rem; color: var(--color-muted-foreground); }
</style>
