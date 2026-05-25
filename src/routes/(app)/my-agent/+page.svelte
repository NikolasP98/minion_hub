<script lang="ts">
	import NavRail from '$lib/components/my-agent/NavRail.svelte';
	import AgentGreeting from '$lib/components/my-agent/AgentGreeting.svelte';
	import FeedSection from '$lib/components/my-agent/FeedSection.svelte';
	import FeedCard from '$lib/components/my-agent/FeedCard.svelte';
	import ChatInput from '$lib/components/my-agent/ChatInput.svelte';
	import OpenHumanAvatar from '$lib/components/my-agent/OpenHumanAvatar.svelte';
	import CallControls from '$lib/components/my-agent/CallControls.svelte';
	import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
	import { conn } from '$lib/state/gateway';
	import { agentChat, ensureAgentChat } from '$lib/state/chat/chat.svelte';
	import { assistant } from '$lib/state/features/assistant.svelte';
	import {
		sendChatMsg,
		loadChatHistory,
		stripVoiceTurnPrefix,
	} from '$lib/services/gateway.svelte';
	import {
		voiceCall,
		mouth,
		startCall,
		endCall,
		toggleMute,
	} from '$lib/state/features/voice-call.svelte';
	import { extractText } from '$lib/utils/text';
	import { getFeedToday, type ObservationRow } from '$lib/services/my-agent-rpc';
	import { tick } from 'svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let observations = $state<ObservationRow[]>([]);
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);
	let lastFetchedAt = $state<number | null>(null);

	// Channel → human label for grouped sections. Unknown channels surface under "Other".
	const CHANNEL_LABEL: Record<string, string> = {
		whatsapp: 'WhatsApp',
		telegram: 'Telegram',
		discord: 'Discord',
		signal: 'Signal',
		slack: 'Slack',
		web: 'Web',
		webchat: 'Web',
	};
	const channelLabel = (c: string) => CHANNEL_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);

	function formatRelative(ts: number): string {
		const diffSec = Math.round((Date.now() - ts) / 1000);
		if (diffSec < 60) return 'just now';
		if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
		if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
		return `${Math.round(diffSec / 86400)}d ago`;
	}

	// Group observations by channel, preserve newest-first ordering within each group.
	type ChannelGroup = { channel: string; label: string; items: ObservationRow[] };
	const grouped = $derived.by<ChannelGroup[]>(() => {
		const map = new Map<string, ChannelGroup>();
		for (const obs of observations) {
			const key = obs.channel || 'other';
			if (!map.has(key)) map.set(key, { channel: key, label: channelLabel(key), items: [] });
			map.get(key)!.items.push(obs);
		}
		return Array.from(map.values());
	});

	async function loadFeed() {
		loading = true;
		errorMsg = null;
		try {
			const res = await getFeedToday();
			observations = res.observations;
			lastFetchedAt = Date.now();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	// Fetch once the WS connection is up. Re-fetch if the connection drops + recovers.
	let fetchedForConnection = false;
	$effect(() => {
		if (conn.connected && !fetchedForConnection) {
			fetchedForConnection = true;
			void loadFeed();
		}
		if (!conn.connected) {
			fetchedForConnection = false;
		}
	});

	// ─── Personal-agent chat (same agent + thread as the floating assistant) ───
	const agentId = $derived(assistant.personalAgentId);
	const chat = $derived(agentId ? agentChat[agentId] : undefined);
	const messages = $derived(chat?.messages ?? []);
	const stream = $derived(chat?.stream ?? null);
	const sending = $derived(chat?.sending ?? false);

	// Lazy-load the conversation history once connected + agent known.
	let historyLoadedFor: string | null = null;
	$effect(() => {
		if (conn.connected && agentId && historyLoadedFor !== agentId) {
			historyLoadedFor = agentId;
			const existing = agentChat[agentId];
			if (!existing || existing.messages.length === 0) loadChatHistory(agentId);
		}
		if (!conn.connected) historyLoadedFor = null;
	});

	function msgRole(msg: unknown): 'user' | 'assistant' {
		return (msg as { role?: string }).role === 'user' ? 'user' : 'assistant';
	}
	function msgTs(msg: unknown): number | undefined {
		return (msg as { timestamp?: number }).timestamp;
	}
	function fmtTime(ts: number | undefined): string {
		if (!ts) return '';
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function handleSubmit(text: string, mode: 'ask' | 'capture') {
		if (mode === 'capture') {
			// Memory capture lands in a later phase.
			console.info('[my-agent] capture', text);
			return;
		}
		if (!agentId || !conn.connected) return;
		const c = ensureAgentChat(agentId);
		c.inputText = text;
		sendChatMsg(agentId);
	}

	// ─── Call wiring ───────────────────────────────────────────────────────────
	// The call engine is a module-level singleton — it dispatches utterances and
	// speaks replies on its own, so it survives navigating away from this page.
	const canCall = $derived(!!agentId && conn.connected);

	function handleStartCall() {
		if (agentId) startCall(agentId);
	}

	// Auto-scroll the chat thread to the newest message.
	let threadEl: HTMLDivElement | null = $state(null);
	let atBottom = $state(true);
	function onThreadScroll() {
		if (!threadEl) return;
		const { scrollTop, scrollHeight, clientHeight } = threadEl;
		atBottom = scrollHeight - scrollTop - clientHeight < 48;
	}
	$effect(() => {
		void messages.length;
		void stream;
		if (atBottom) {
			tick().then(() => {
				if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
			});
		}
	});

	const STATUS_CAPTION: Record<string, string> = {
		idle: 'Mic muted',
		listening: 'Listening — go ahead',
		thinking: 'Thinking…',
		speaking: 'Speaking…',
	};
</script>

<svelte:head>
	<title>My Agent · Minion</title>
</svelte:head>

<div class="layout">
	<NavRail />

	<main class="column" aria-labelledby="my-agent-greeting">
		<div class="inner">
			<header class="greeting-row">
				{#if !voiceCall.active}
					<div class="mini-avatar">
						<OpenHumanAvatar mouthRef={mouth} status={voiceCall.status} />
					</div>
				{/if}
				<div class="greeting-text">
					<AgentGreeting greeting={data.greeting} userName={data.userName} />
				</div>
				<CallControls
					active={voiceCall.active}
					muted={voiceCall.muted}
					status={voiceCall.status}
					disabled={!canCall}
					onstart={handleStartCall}
					onend={endCall}
					ontoggleMute={toggleMute}
				/>
			</header>

			{#if voiceCall.error}
				<p class="state-note error">{voiceCall.error}</p>
			{/if}

			<!-- Stage: avatar sits ABOVE the agenda normally; during a call it moves
			     SIDE-BY-SIDE, taking the majority of the width and the agenda's full height. -->
			<div class="stage" class:in-call={voiceCall.active}>
				{#if voiceCall.active}
					<section class="avatar-stage" aria-label="Agent avatar">
						<div class="avatar-big">
							<OpenHumanAvatar mouthRef={mouth} status={voiceCall.status} />
						</div>
						<p class="avatar-caption">
							{STATUS_CAPTION[voiceCall.status] ?? ''}
							{#if voiceCall.interim}<span class="interim">“{voiceCall.interim}”</span>{/if}
						</p>
					</section>
				{/if}

				<section class="agenda" aria-label="Today">
					{#if !conn.connected}
						<p class="state-note">Connect a gateway to see your feed.</p>
					{:else if loading && observations.length === 0}
						<p class="state-note">Loading…</p>
					{:else if errorMsg}
						<p class="state-note error">Feed failed: {errorMsg}</p>
						<button type="button" class="retry" onclick={loadFeed}>Retry</button>
					{:else if observations.length === 0}
						<p class="state-note">
							Quiet so far today. As you exchange messages with your agents, they'll surface here.
						</p>
					{:else}
						{#each grouped as group (group.channel)}
							<FeedSection label={group.label} count={group.items.length}>
								{#each group.items as obs (obs.id)}
									{@const title = obs.contentPreview ?? '(no content)'}
									{@const subtitle = `${obs.direction === 'inbound' ? '←' : '→'} ${obs.agentId ?? '?'} · ${formatRelative(obs.observedAt)}`}
									<FeedCard
										{title}
										{subtitle}
										onreply={() => handleSubmit(`About: ${title}`, 'ask')}
										onsnooze={() => {}}
										ondismiss={() => {}}
										onopen={() => {}}
									/>
								{/each}
							</FeedSection>
						{/each}
					{/if}
				</section>
			</div>

			<div class="history">
				<hr />
				<p class="history-note">Yesterday and earlier · history tray lands in a later phase</p>
			</div>

			<!-- Chat section: typed messages AND the live call transcript land here.
			     Grows to fill the space between the agenda and the input. -->
			<section class="chat-section" aria-label="Conversation">
				{#if messages.length > 0 || stream || sending}
					<div class="thread" bind:this={threadEl} onscroll={onThreadScroll}>
						<div class="thread-inner">
							{#each messages as msg, i (`${msgTs(msg) ?? ''}_${i}`)}
								{@const role = msgRole(msg)}
								{@const text = stripVoiceTurnPrefix(extractText(msg) ?? '')}
								{#if text}
									<div class="bubble-row {role}">
										<div class="bubble {role}">
											{#if role === 'assistant'}
												<MarkdownMessage value={text} tone="assistant" />
											{:else}
												{text}
											{/if}
										</div>
										{#if msgTs(msg)}<span class="bubble-time">{fmtTime(msgTs(msg))}</span>{/if}
									</div>
								{/if}
							{/each}

							{#if stream !== null && stream !== ''}
								<div class="bubble-row assistant">
									<div class="bubble assistant streaming">
										<MarkdownMessage value={stream} tone="assistant" />
									</div>
								</div>
							{:else if sending}
								<div class="thinking-row">
									<span class="dot"></span><span class="dot"></span><span class="dot"></span>
									Thinking…
								</div>
							{/if}

							{#if chat?.lastError}
								<p class="state-note error">{chat.lastError}</p>
							{/if}
						</div>
					</div>
				{/if}
			</section>

			<ChatInput onsubmit={handleSubmit} />
		</div>
	</main>
</div>

<style>
	.layout {
		display: flex;
		flex: 1;
		min-height: 0;
		background: var(--color-bg, #0d0d0d);
	}

	.column {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		justify-content: center;
	}

	.inner {
		width: 100%;
		max-width: 720px;
		padding: 0 24px;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.greeting-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-top: 8px;
	}

	.greeting-text {
		flex: 1;
		min-width: 0;
	}

	.mini-avatar {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border-radius: 50%;
		overflow: hidden;
		background: radial-gradient(circle at 50% 40%, #1b1408, #0c0a05 80%);
		box-shadow: 0 0 0 1px rgba(232, 125, 106, 0.6);
	}

	/* Stage: avatar above agenda by default. */
	.stage {
		display: flex;
		flex-direction: column;
		gap: 16px;
		flex-shrink: 0;
	}

	/* Agenda stays compact by default, but expands with content (capped, scrolls). */
	.stage:not(.in-call) .agenda {
		max-height: 30vh;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	/* During a call: avatar beside the agenda, majority width, full height. */
	.stage.in-call {
		flex-direction: row;
		align-items: stretch;
		min-height: 320px;
		margin-bottom: 8px;
	}

	.stage.in-call .avatar-stage {
		flex: 1.8;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 16px;
		border-radius: 16px;
		background: radial-gradient(circle at 50% 35%, rgba(247, 209, 69, 0.07), rgba(12, 12, 12, 0) 70%);
		border: 1px solid rgba(255, 255, 255, 0.06);
	}

	.stage.in-call .avatar-big {
		width: 100%;
		max-width: 340px;
		aspect-ratio: 1 / 1;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
	}

	.avatar-caption {
		margin: 0;
		font-size: 13px;
		color: rgba(255, 255, 255, 0.65);
		text-align: center;
		min-height: 18px;
	}
	.interim {
		display: block;
		color: rgba(255, 255, 255, 0.4);
		font-style: italic;
		font-size: 12px;
		margin-top: 4px;
	}

	.stage.in-call .agenda {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		max-height: 100%;
		padding-right: 4px;
	}

	/* Chat section grows to fill the space between the agenda and the input. */
	.chat-section {
		flex: 1;
		min-height: 220px;
		display: flex;
		flex-direction: column;
		margin-top: 8px;
		padding-top: 4px;
	}

	.thread {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		scrollbar-width: thin;
		padding: 4px 2px;
	}

	/* Pin messages to the bottom when short, but stay fully scrollable when the
	   history overflows (justify-content:flex-end on the scroller would make the
	   top unreachable — margin-top:auto on an inner block does not). */
	.thread-inner {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.bubble-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bubble-row.user {
		align-items: flex-end;
	}
	.bubble-row.assistant {
		align-items: flex-start;
	}

	.bubble {
		max-width: 85%;
		border-radius: 12px;
		padding: 8px 12px;
		font-size: 13px;
		line-height: 1.5;
		word-break: break-word;
	}
	.bubble.user {
		background: rgba(232, 125, 106, 0.14);
		border: 1px solid rgba(232, 125, 106, 0.22);
		color: rgba(255, 255, 255, 0.92);
		white-space: pre-wrap;
	}
	.bubble.assistant {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.9);
	}
	.bubble.assistant.streaming {
		border-style: dashed;
		opacity: 0.9;
	}

	.bubble-time {
		font-size: 9px;
		color: rgba(255, 255, 255, 0.35);
		padding: 0 4px;
		font-variant-numeric: tabular-nums;
	}

	.thinking-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.45);
		padding: 4px 6px;
	}
	.thinking-row .dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: #e87d6a;
		animation: blink 1.2s infinite;
	}
	.thinking-row .dot:nth-child(2) {
		animation-delay: 0.15s;
	}
	.thinking-row .dot:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes blink {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 1;
		}
	}

	.state-note {
		font-size: 13px;
		color: rgba(255, 255, 255, 0.45);
		padding: 8px 4px;
	}
	.state-note.error {
		color: #e87d6a;
	}

	.retry {
		align-self: flex-start;
		background: transparent;
		border: 1px solid rgba(232, 125, 106, 0.4);
		color: #e87d6a;
		padding: 4px 10px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
	}

	.history {
		opacity: 0.6;
		margin-top: 16px;
		flex-shrink: 0;
	}
	.history hr {
		border: none;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		margin: 0 0 16px;
	}
	.history-note {
		font-size: 12px;
		color: rgba(255, 255, 255, 0.35);
		margin: 0;
	}

	@media (max-width: 640px) {
		.stage.in-call {
			flex-direction: column;
		}
	}
</style>
