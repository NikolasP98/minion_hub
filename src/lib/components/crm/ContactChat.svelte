<script lang="ts">
	import { tick } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { ArrowDown, SendHorizontal } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import JourneyTimeline from './JourneyTimeline.svelte';

	type TRow = {
		kind?: string;
		channel?: string | null;
		body?: string | null;
		occurred_at?: string;
		direction?: string | null;
		source_id?: string;
	};
	let {
		rows,
		contactId,
		channel,
		canSend = true,
	}: { rows: TRow[]; contactId: string; channel: string; canSend?: boolean } = $props();

	// Count only what JourneyTimeline actually renders (non-empty bodies) so the
	// "new messages" detection matches the visible bubbles.
	const shownCount = $derived(rows.filter((r) => (r.body ?? '').trim().length > 0).length);

	let scrollEl = $state<HTMLDivElement | null>(null);
	// `stick` = keep the view pinned to the newest message. It flips ONLY from real
	// user scrolls; our own programmatic scrolls are ignored via the guard so the
	// onscroll fired while content grows can't knock us off the bottom.
	let stick = $state(true);
	let unseen = $state(0);
	let prevCount = 0;
	let prevChannel = '';
	let programmatic = false;

	const NEAR = 80;
	function onScroll() {
		if (programmatic || !scrollEl) return;
		stick = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= NEAR;
		if (stick) unseen = 0;
	}
	function toBottom() {
		if (!scrollEl) return;
		programmatic = true;
		scrollEl.scrollTop = scrollEl.scrollHeight; // instant — smooth races the content growth
		stick = true;
		unseen = 0;
		// Release after layout settles so the resulting onscroll doesn't flip `stick`.
		requestAnimationFrame(() => requestAnimationFrame(() => (programmatic = false)));
	}

	// Channel switch → pin to the newest message.
	$effect(() => {
		if (channel !== prevChannel) {
			prevChannel = channel;
			prevCount = shownCount;
			stick = true;
			void tick().then(toBottom);
		}
	});

	// Any rows change (poll refresh, new inbound, optimistic reconcile). While
	// sticking, stay pinned — this also re-anchors when a refresh re-creates the
	// list DOM and the browser resets scrollTop to the top. Otherwise count the
	// new arrivals into the "jump to latest" pill.
	$effect(() => {
		void rows; // track the array identity (replaced every poll)
		const n = shownCount;
		if (channel !== prevChannel) return; // channel effect handles the switch
		if (stick) void tick().then(toBottom);
		else if (n > prevCount) unseen += n - prevCount;
		prevCount = n;
	});

	// Optimistic queue: the input never blocks. Each send appends a pending bubble
	// immediately and fires its POST independently; on success the real row arrives
	// via invalidate and we drop the pending twin; on failure it stays with a retry.
	type Pending = { id: number; text: string; failed: boolean };
	let pending = $state<Pending[]>([]);
	let draft = $state('');
	let seq = 0;

	async function dispatch(p: Pending) {
		try {
			const res = await fetch(`/api/crm/contacts/${contactId}/message`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ channel, text: p.text }),
			});
			if (!res.ok) {
				pending = pending.map((x) => (x.id === p.id ? { ...x, failed: true } : x));
				return;
			}
			// Real row is committed before the 200; refresh, then drop the optimistic twin.
			await invalidate('crm:contact');
			pending = pending.filter((x) => x.id !== p.id);
		} catch {
			pending = pending.map((x) => (x.id === p.id ? { ...x, failed: true } : x));
		}
	}
	function send() {
		const text = draft.trim();
		if (!text) return;
		const p: Pending = { id: ++seq, text, failed: false };
		pending = [...pending, p];
		draft = '';
		stick = true;
		void tick().then(toBottom);
		void dispatch(p);
	}
	function retry(p: Pending) {
		pending = pending.map((x) => (x.id === p.id ? { ...x, failed: false } : x));
		void dispatch(p);
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="chat">
	<div class="scroll" bind:this={scrollEl} onscroll={onScroll}>
		<JourneyTimeline rows={rows as never} hideHeaders />
		{#if pending.length}
			<ol class="pending-thread">
				{#each pending as p (p.id)}
					<li class="row out">
						<div class="bubble" class:failed={p.failed}>
							<p class="text">{p.text}</p>
							{#if p.failed}
								<button class="retry" onclick={() => retry(p)}>{m.crm_send_failed()}</button>
							{:else}
								<span class="time">···</span>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</div>

	{#if unseen > 0 && !stick}
		<button class="new-pill" onclick={toBottom}>
			<ArrowDown size={13} />
			{m.crm_new_messages({ count: unseen })}
		</button>
	{/if}

	{#if canSend}
		<div class="composer">
			<textarea
				class="c-input"
				bind:value={draft}
				onkeydown={onKey}
				placeholder={m.crm_message_placeholder()}
				rows="1"
			></textarea>
			<button class="c-send" onclick={send} disabled={!draft.trim()} aria-label={m.crm_send()}>
				<SendHorizontal size={16} />
			</button>
		</div>
	{/if}
</div>

<style>
	.chat {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
	}
	.new-pill {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		bottom: 4.2rem;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.28rem 0.7rem;
		border-radius: 999px;
		background: var(--color-primary, var(--color-emerald, var(--color-success)));
		color: var(--color-primary-foreground, #fff);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
		z-index: 2;
	}
	.composer {
		display: flex;
		align-items: flex-end;
		gap: 0.4rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--hairline);
		margin-top: 0.4rem;
	}
	.c-input {
		flex: 1;
		resize: none;
		max-height: 6rem;
		min-height: 2.2rem;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--color-background);
		color: var(--color-foreground);
		font-size: 0.84rem;
		line-height: 1.3;
		font-family: inherit;
	}
	.c-input:focus {
		outline: none;
		border-color: var(--color-primary, var(--color-emerald, var(--color-success)));
	}
	.c-send {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		flex-shrink: 0;
		border-radius: var(--radius-md);
		background: var(--color-primary, var(--color-emerald, var(--color-success)));
		color: var(--color-primary-foreground, #fff);
	}
	.c-send:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	/* Optimistic pending bubbles (JourneyTimeline's bubble styles are scoped to it). */
	.pending-thread {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		list-style: none;
		margin: 0.3rem 0 0;
		padding: 0;
	}
	.row {
		display: flex;
		justify-content: flex-end;
	}
	.bubble {
		position: relative;
		max-width: 80%;
		padding: 0.38rem 0.6rem 0.34rem;
		border-radius: 0.85rem;
		border-bottom-right-radius: 0.2rem;
		background: color-mix(in srgb, var(--color-emerald, var(--color-success)) 22%, var(--color-card));
		color: var(--color-foreground);
		opacity: 0.7;
	}
	.bubble.failed {
		opacity: 1;
		background: color-mix(in srgb, var(--color-destructive, #f87171) 18%, var(--color-card));
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
	.retry {
		display: block;
		margin-top: 0.15rem;
		margin-left: auto;
		font-size: 0.62rem;
		font-weight: 600;
		color: var(--color-destructive, #f87171);
		text-decoration: underline;
	}
</style>
