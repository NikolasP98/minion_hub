<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import AgentGreeting from '$lib/components/my-agent/AgentGreeting.svelte';
	import FeedSection from '$lib/components/my-agent/FeedSection.svelte';
	import FeedCard from '$lib/components/my-agent/FeedCard.svelte';
	import EventCard from '$lib/components/my-agent/EventCard.svelte';
	import EmailCard from '$lib/components/my-agent/EmailCard.svelte';
	import EventModal from '$lib/components/my-agent/EventModal.svelte';
	import EmailModal from '$lib/components/my-agent/EmailModal.svelte';
	import ChatInput from '$lib/components/my-agent/ChatInput.svelte';
	import OpenHumanAvatar from '$lib/components/my-agent/OpenHumanAvatar.svelte';
	import CallControls from '$lib/components/my-agent/CallControls.svelte';
	import NotesPanel from '$lib/components/my-agent/NotesPanel.svelte';
	import ChatTurn from '$lib/components/my-agent/ChatTurn.svelte';
	import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
	import type { ChatMessage } from '$lib/types/chat';
	import {
		contentBlocks,
		isToolResultOnly,
		assistantHasContent,
		toolResultsById as computeToolResultsById,
		type ToolResult,
	} from '$lib/chat/blocks';
	import { notesState, loadNotes } from '$lib/state/features/agent-notes.svelte';
	import { conn } from '$lib/state/gateway';
	import { agentChat, ensureAgentChat } from '$lib/state/chat/chat.svelte';
	import { assistant } from '$lib/state/features/assistant.svelte';
	import {
		sendChatMsg,
		resetChat,
		loadChatHistory,
		stripVoiceTurnPrefix,
		cleanInboundForDisplay,
		parseUserContext,
		type UserContextChip,
	} from '$lib/services/gateway.svelte';
	import {
		voiceCall,
		mouth,
		startCall,
		endCall,
		toggleMute,
	} from '$lib/state/features/voice-call.svelte';
	import { extractText } from '$lib/utils/text';
	import {
		getFeedToday,
		type ObservationRow,
		type CalendarItem,
		type EmailItem,
	} from '$lib/services/my-agent-rpc';
	import { createConnectedFetch } from '$lib/state/async.svelte';
	import { distinctProviders } from '$lib/components/my-agent/provider';
	import { dragContextIcon, type DragContextKind } from '$lib/utils/drag-context';
	import { ChevronDown, MessageSquarePlus } from 'lucide-svelte';
	import { tick } from 'svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let observations = $state<ObservationRow[]>([]);
	let calendarItems = $state<CalendarItem[]>([]);
	let emailItems = $state<EmailItem[]>([]);
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);
	let lastFetchedAt = $state<number | null>(null);

	// Shared "now" for the feed cards — one ticking value so every event/email card
	// re-derives its relative time + proximity tier together (cheap, 30s cadence).
	let nowMs = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	// "New since last view" highlight for emails. We persist the newest receivedAt
	// the user has already seen in localStorage; anything newer renders with the
	// fresh accent until the next visit re-baselines it.
	const LAST_SEEN_KEY = 'minion:my-agent:emails-last-seen';
	let emailsLastSeen = $state(0);
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		const raw = localStorage.getItem(LAST_SEEN_KEY);
		emailsLastSeen = raw ? Number(raw) || 0 : 0;
	});
	function emailReceivedMs(item: EmailItem): number {
		if (!item.receivedAt) return 0;
		const ts = Date.parse(item.receivedAt);
		return Number.isNaN(ts) ? 0 : ts;
	}
	const isEmailNew = (item: EmailItem) => {
		const ms = emailReceivedMs(item);
		return ms > 0 && ms > emailsLastSeen;
	};
	// Re-baseline the "seen" marker shortly after emails render, so the green
	// accents persist for the current view but clear on the next visit.
	$effect(() => {
		if (emailItems.length === 0 || typeof localStorage === 'undefined') return;
		const newest = emailItems.reduce((max, m) => Math.max(max, emailReceivedMs(m)), 0);
		if (newest <= emailsLastSeen) return;
		const id = setTimeout(() => {
			localStorage.setItem(LAST_SEEN_KEY, String(newest));
		}, 4000);
		return () => clearTimeout(id);
	});

	// ─── Feed item modals (open in-place instead of navigating to Google) ───
	let selectedEvent = $state<CalendarItem | null>(null);
	let eventModalOpen = $state(false);
	let selectedEmail = $state<EmailItem | null>(null);
	let emailModalOpen = $state(false);

	function openEvent(ev: CalendarItem) {
		selectedEvent = ev;
		eventModalOpen = true;
	}
	function openEmail(mail: EmailItem) {
		selectedEmail = mail;
		emailModalOpen = true;
	}
	// Route a modal action through the personal-agent chat (it holds gws tools).
	function askAgent(prompt: string) {
		handleSubmit(prompt, 'ask');
	}

	// True when there's nothing at all to show — drives the empty-state copy.
	const feedEmpty = $derived(
		observations.length === 0 && calendarItems.length === 0 && emailItems.length === 0,
	);

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

	// Group upcoming events by calendar day so the list carries sleek day dividers
	// instead of repeating "Today" on every card.
	type EventDay = { key: string; label: string; items: CalendarItem[] };
	const eventGroups = $derived.by<EventDay[]>(() => {
		const now = new Date(nowMs);
		const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
		const tomorrow = new Date(now);
		tomorrow.setDate(now.getDate() + 1);
		const tomorrowKey = `${tomorrow.getFullYear()}-${tomorrow.getMonth()}-${tomorrow.getDate()}`;

		const groups: EventDay[] = [];
		for (const ev of calendarItems) {
			const d = new Date(ev.startsAt);
			const valid = !Number.isNaN(d.getTime());
			const key = valid ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : 'tba';
			let g = groups.find((x) => x.key === key);
			if (!g) {
				let label = 'Scheduled';
				if (valid) {
					if (key === todayKey) label = 'Today';
					else if (key === tomorrowKey) label = 'Tomorrow';
					else label = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
				}
				g = { key, label, items: [] };
				groups.push(g);
			}
			g.items.push(ev);
		}
		return groups;
	});

	// Group emails by calendar day (Today / Yesterday / date) so the inbox carries
	// the same sleek day dividers the events column has. Emails arrive newest-first.
	type EmailDay = { key: string; label: string; items: EmailItem[] };
	const emailGroups = $derived.by<EmailDay[]>(() => {
		const now = new Date(nowMs);
		const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		const todayKey = dayKey(now);
		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);
		const yesterdayKey = dayKey(yesterday);

		const groups: EmailDay[] = [];
		for (const mail of emailItems) {
			const ms = mail.receivedAt ? Date.parse(mail.receivedAt) : NaN;
			const valid = !Number.isNaN(ms);
			const d = valid ? new Date(ms) : now;
			const key = valid ? dayKey(d) : 'unknown';
			let g = groups.find((x) => x.key === key);
			if (!g) {
				let label = 'Earlier';
				if (valid) {
					if (key === todayKey) label = 'Today';
					else if (key === yesterdayKey) label = 'Yesterday';
					else label = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
				}
				g = { key, label, items: [] };
				groups.push(g);
			}
			g.items.push(mail);
		}
		return groups;
	});

	// Provider badges per section (derived from the linked-identity source emails).
	const eventProviders = $derived(distinctProviders(calendarItems.map((e) => e.sourceEmail)));
	const emailProviders = $derived(distinctProviders(emailItems.map((m) => m.sourceEmail)));

	// Next upcoming event + newest email power the collapsed-section summaries.
	const nextEvent = $derived(calendarItems[0] ?? null);
	const latestEmail = $derived(emailItems[0] ?? null);

	// One shared collapse state drives BOTH feed columns together (a single toggle),
	// persisted so the layout the user prefers sticks across visits.
	const COLLAPSE_KEY = 'minion:my-agent:feed-collapsed';
	let feedCollapsed = $state(false);
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		feedCollapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
	});
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(COLLAPSE_KEY, feedCollapsed ? '1' : '0');
	});
	// A single bottom-center handle (below both columns) drives the shared state.
	const hasFeed = $derived(calendarItems.length > 0 || emailItems.length > 0);

	async function loadFeed() {
		loading = true;
		errorMsg = null;
		try {
			const res = await getFeedToday();
			observations = res.observations;
			calendarItems = res.calendarItems;
			emailItems = res.emailItems;
			lastFetchedAt = Date.now();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	// Fetch once the WS connection is up. Re-fetch if the connection drops + recovers.
	const feedFetch = createConnectedFetch(() => conn.connected, () => void loadFeed());
	$effect(() => feedFetch.sync());

	// Hydrate the notes/todos panel from localStorage (idempotent).
	$effect(() => {
		loadNotes();
	});

	// ─── Personal-agent chat (same agent + thread as the floating assistant) ───
	const agentId = $derived(assistant.personalAgentId);
	const chat = $derived(agentId ? agentChat[agentId] : undefined);
	const messages = $derived(chat?.messages ?? []);
	const stream = $derived(chat?.stream ?? null);
	const streamMessage = $derived(chat?.streamMessage ?? null);
	const streamDisplay = $derived(chat?.streamDisplay ?? '');
	const sending = $derived(chat?.sending ?? false);

	// ─── Rich content-block helpers (thinking + tools, claude-desktop style) ───
	// Hoisted to $lib/chat/blocks.ts — shared across all 5 chat surfaces.

	// Live per-run tool calls + context-aware activity verb (gateway tool events).
	const liveTools = $derived(chat?.liveTools ?? []);
	const liveActivity = $derived(chat?.liveActivity ?? null);

	// tool_use_id → result, collected across the whole thread (results live in the
	// following user-role turn) so each tool card can show its outcome. Live tool
	// results (streaming run) are merged on top so in-flight cards resolve ✓/⚠.
	const toolResultsById = $derived.by<Record<string, ToolResult>>(() => {
		const map = computeToolResultsById(streamMessage ? [...messages, streamMessage] : messages);
		for (const t of liveTools) {
			if (t.done && !map[t.id]) map[t.id] = { content: t.result ?? '', isError: !!t.isError };
		}
		return map;
	});

	// The streaming turn's message: live tool blocks (which chat deltas don't
	// carry — they're text-only) merged ahead of the delta message's own blocks.
	const streamTurnMessage = $derived.by<ChatMessage | null>(() => {
		if (liveTools.length === 0) return streamMessage;
		const baseBlocks = streamMessage ? contentBlocks(streamMessage.content) : [];
		const have = new Set(
			baseBlocks
				.filter((b) => b?.type === 'tool_use' || b?.type === 'toolCall')
				.map((b) => b.id as string),
		);
		return {
			role: 'assistant',
			content: [
				...liveTools
					.filter((t) => !have.has(t.id))
					.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })),
				...baseBlocks,
			],
		} as ChatMessage;
	});

	// Stable per-row key derived from content (NOT array index) — so reconciling
	// server history into the optimistic thread reuses DOM instead of re-mounting
	// every row (the old `${ts}_${i}` key was the "history flash" culprit).
	function rowKey(m: ChatMessage): string {
		const t =
			msgRole(m) === 'user'
				? cleanInboundForDisplay(extractText(m) ?? '')
				: stripVoiceTurnPrefix(extractText(m) ?? '');
		const toolNames = contentBlocks(m.content)
			.filter((b) => b?.type === 'tool_use' || b?.type === 'toolCall')
			.map((b) => b.name)
			.join(',');
		return `${msgRole(m)}|${t.length}|${t.slice(0, 32)}|${t.slice(-24)}|${toolNames}`;
	}

	interface RenderedRow {
		key: string;
		msg: ChatMessage;
		role: 'user' | 'assistant';
		ts?: number;
		text: string;
		/** Dragged-context blocks parsed out of a user message — render as chips. */
		chips: UserContextChip[];
	}
	const renderedMessages = $derived.by<RenderedRow[]>(() => {
		const seen = new Map<string, number>();
		const rows: RenderedRow[] = [];
		for (const raw of messages) {
			const m = raw as ChatMessage;
			if (isToolResultOnly(m)) continue;
			const role = msgRole(m);
			let text =
				role === 'user'
					? cleanInboundForDisplay(extractText(m) ?? '')
					: stripVoiceTurnPrefix(extractText(m) ?? '');
			let chips: UserContextChip[] = [];
			if (role === 'user') {
				({ chips, text } = parseUserContext(text));
			}
			if (role === 'user' ? text.trim().length === 0 && chips.length === 0 : !assistantHasContent(m))
				continue;
			const base = rowKey(m);
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			rows.push({ key: `${base}#${n}`, msg: m, role, ts: msgTs(m), text, chips });
		}
		return rows;
	});

	// Live status while a run streams: the context-aware verb from live tool
	// events ("Reading…", "Remembering…") wins; falls back to block inspection,
	// then "Thinking…". Null while answer text is streaming (it shows itself).
	const streamActivity = $derived.by<string | null>(() => {
		if (liveActivity) return liveActivity;
		if (!streamMessage) return null;
		const blocks = contentBlocks(streamMessage.content);
		if (blocks.length === 0) return 'Thinking…';
		const last = [...blocks].reverse().find((b) => b?.type);
		if (!last) return 'Thinking…';
		if (last.type === 'tool_use') return `Using ${(last.name as string) ?? 'a tool'}…`;
		if (last.type === 'thinking' || last.type === 'redacted_thinking') return 'Thinking…';
		return null; // text block streaming — the partial answer shows itself
	});

	// Whether the live streaming turn has any visible content yet (reasoning/tool
	// meta, live tool rows, or smoothed answer text being revealed).
	const streamHasContent = $derived(
		(!!streamMessage && assistantHasContent(streamMessage)) ||
			liveTools.length > 0 ||
			streamDisplay.length > 0
	);

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
		void streamMessage;
		void streamDisplay;
		void streamActivity;
		void liveTools.length;
		if (atBottom) {
			tick().then(() => {
				if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
			});
		}
	});

	const STATUS_CAPTION: Record<string, string> = {
		idle: m.page_micMuted(),
		listening: m.page_listening(),
		thinking: m.call_thinking(),
		speaking: m.call_speaking(),
	};
</script>

<svelte:head>
	<title>My Agent · Minion</title>
</svelte:head>

<div class="layout">
	<main class="column" aria-labelledby="my-agent-greeting">
		<div class="inner">
			<!-- Reserve the top-right notch clearance ONLY when the notes panel is
			     collapsed — then the column reaches under the floating utility
			     cluster. When the panel is open it sits over the panel, so the
			     header takes full width (no clearance) and the greeting breathes. -->
			<header class="greeting-row" class:notch-pad={!notesState.open}>
				<div class="identity">
					{#if !voiceCall.active}
						<div class="mini-avatar">
							<OpenHumanAvatar mouthRef={mouth} status={voiceCall.status} />
						</div>
					{/if}
					<div class="greeting-text">
						<AgentGreeting greeting={data.greeting} userName={data.userName} />
					</div>
				</div>
				<button
					type="button"
					class="new-chat"
					disabled={!agentId || !conn.connected || sending}
					title={m.chat_newChat()}
					onclick={() => agentId && resetChat(agentId)}
				>
					<MessageSquarePlus size={14} />
					<span>{m.chat_newChat()}</span>
				</button>
			</header>

			{#if voiceCall.error}
				<p class="state-note error">{voiceCall.error}</p>
			{/if}

			<!-- Stage: avatar sits ABOVE the agenda normally; during a call it moves
			     SIDE-BY-SIDE, taking the majority of the width and the agenda's full height. -->
			<div class="stage" class:in-call={voiceCall.active}>
				{#if voiceCall.active}
					<section class="avatar-stage" aria-label={m.a11y1_agentAvatar()}>
						<div class="avatar-big">
							<OpenHumanAvatar mouthRef={mouth} status={voiceCall.status} />
						</div>
						<p class="avatar-caption">
							{STATUS_CAPTION[voiceCall.status] ?? ''}
							{#if voiceCall.interim}<span class="interim">“{voiceCall.interim}”</span>{/if}
						</p>
					</section>
				{/if}

				<section class="agenda" aria-label={m.common_today()}>
					{#if !conn.connected}
						<p class="state-note">{m.feed_connectGateway()}</p>
					{:else if loading && feedEmpty}
						<p class="state-note">{m.common_loading()}</p>
					{:else if errorMsg}
						<p class="state-note error">{m.feed_failed({ error: errorMsg })}</p>
						<button type="button" class="retry" onclick={loadFeed}>{m.common_retry()}</button>
					{:else if feedEmpty}
						<p class="state-note">
							{m.feed_quiet()}
						</p>
					{:else}
						<!-- Calendar events + emails sit side-by-side (events | emails) while the
						     agenda runs as a band at the top, and stack vertically when the
						     agenda becomes a narrow column during a call. A lone section (only
						     events OR only emails) spans the full width via :only-child. -->
						<div class="feed-group">
						<div class="feed-grid">
							<!-- Upcoming calendar events (next 24h across linked Google calendars). -->
							{#if calendarItems.length > 0}
								<FeedSection
									label={m.feed_eventsLabel()}
									count={calendarItems.length}
									providers={eventProviders}
									bind:collapsed={feedCollapsed}
									scrollable
								>
									{#each eventGroups as day (day.key)}
										<div class="day-divider">
											<span class="day-label">{day.label}</span>
											<span class="day-rule"></span>
											<span class="day-count">{day.items.length}</span>
										</div>
										{#each day.items as ev (ev.sourceEmail + ':' + ev.id)}
											<EventCard item={ev} {nowMs} onopen={() => openEvent(ev)} />
										{/each}
									{/each}

									{#snippet summary()}
										{#if nextEvent}
											{@const ev = nextEvent}
											<EventCard item={ev} {nowMs} onopen={() => openEvent(ev)} />
											{#if calendarItems.length > 1}
												<button
													type="button"
													class="more-row"
													onclick={() => (feedCollapsed = false)}
												>
													{m.feed_more({ count: calendarItems.length - 1 })}
												</button>
											{/if}
										{/if}
									{/snippet}
								</FeedSection>
							{/if}

							<!-- Inbox emails across linked Google identities. -->
							{#if emailItems.length > 0}
								<FeedSection
									label={m.feed_emailsLabel()}
									count={emailItems.length}
									providers={emailProviders}
									bind:collapsed={feedCollapsed}
									scrollable
								>
									{#each emailGroups as day (day.key)}
										<div class="day-divider">
											<span class="day-label">{day.label}</span>
											<span class="day-rule"></span>
											<span class="day-count">{day.items.length}</span>
										</div>
										{#each day.items as mail (mail.sourceEmail + ':' + mail.id)}
											<EmailCard
												item={mail}
												{nowMs}
												isNew={isEmailNew(mail)}
												onopen={() => openEmail(mail)}
											/>
										{/each}
									{/each}

									{#snippet summary()}
										{#if latestEmail}
											{@const mail = latestEmail}
											<EmailCard
												item={mail}
												{nowMs}
												isNew={isEmailNew(mail)}
												onopen={() => openEmail(mail)}
											/>
											{#if emailItems.length > 1}
												<button
													type="button"
													class="more-row"
													onclick={() => (feedCollapsed = false)}
												>
													{m.feed_more({ count: emailItems.length - 1 })}
												</button>
											{/if}
										{/if}
									{/snippet}
								</FeedSection>
							{/if}
						</div>

							{#if hasFeed}
								<button
									type="button"
									class="feed-toggle"
									class:open={!feedCollapsed}
									aria-expanded={!feedCollapsed}
									title={feedCollapsed ? m.feed_expand() : m.feed_collapse()}
									onclick={() => (feedCollapsed = !feedCollapsed)}
								>
									<ChevronDown size={14} />
								</button>
							{/if}
						</div>

						<!-- Recent cross-channel agent activity, grouped by channel. -->
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

			<!-- Chat section: typed messages AND the live call transcript land here.
			     Grows to fill the space between the agenda and the input. -->
			<section class="chat-section" aria-label={m.feed_conversationAria()}>
				{#if renderedMessages.length > 0 || streamMessage || stream || sending}
					<div class="thread" bind:this={threadEl} onscroll={onThreadScroll}>
						<div class="thread-inner">
							{#each renderedMessages as row, ri (row.key)}
								<!-- One timestamp per MESSAGE BLOCK: a run of same-role rows (an
								     agent turn spans several tool/reasoning messages) stamps only
								     its last row, not every intermediate action. -->
								{@const blockEnd =
									ri === renderedMessages.length - 1 || renderedMessages[ri + 1].role !== row.role}
								{#if row.role === 'assistant'}
									<!-- Assistant turn: ChatTurn owns its layout — quiet reasoning/tool
									     rows OUTSIDE the bubble, the reply inside its own bubble. -->
									<div class="bubble-row assistant">
										<ChatTurn message={row.msg} toolResults={toolResultsById} />
										{#if row.ts && blockEnd}<span class="bubble-time">{fmtTime(row.ts)}</span>{/if}
									</div>
								{:else}
									<div class="bubble-row user">
										{#if row.chips.length > 0}
											<div class="sent-chips">
												{#each row.chips as chip, ci (ci)}
													<span class="sent-chip" title={chip.text}>
														<span aria-hidden="true">{dragContextIcon(chip.kind as DragContextKind)}</span>
														<span class="sent-chip-label">{chip.label}</span>
													</span>
												{/each}
											</div>
										{/if}
										{#if row.text.trim().length > 0}
											<div class="bubble user">{row.text}</div>
										{/if}
										{#if row.ts && blockEnd}<span class="bubble-time">{fmtTime(row.ts)}</span>{/if}
									</div>
								{/if}
							{/each}

							<!-- Live streaming turn: reasoning/tool rows surface above the reply;
							     the answer text is the smoothed (typewriter) reveal via textOverride. -->
							{#if streamHasContent && streamTurnMessage}
								<div class="bubble-row assistant">
									<ChatTurn
										message={streamTurnMessage}
										toolResults={toolResultsById}
										streaming
										textOverride={streamDisplay}
									/>
									{#if streamDisplay.length === 0}
										<!-- Tools running, no answer text yet — live activity verb. -->
										<div class="thinking-row">
											<span class="dot"></span><span class="dot"></span><span class="dot"></span>
											{streamActivity ?? 'Thinking…'}
										</div>
									{/if}
								</div>
							{:else if streamDisplay.length > 0}
								<!-- Fallback: smoothed text with no structured message. -->
								<div class="bubble-row assistant">
									<div class="bubble assistant streaming">
										<MarkdownMessage value={streamDisplay} tone="assistant" />
									</div>
								</div>
							{:else if sending || streamMessage}
								<div class="thinking-row">
									<span class="dot"></span><span class="dot"></span><span class="dot"></span>
									{streamActivity ?? 'Thinking…'}
								</div>
							{/if}

							{#if chat?.lastError}
								<p class="state-note error">{chat.lastError}</p>
							{/if}
						</div>
					</div>
				{/if}
			</section>

			<div class="composer">
				<div class="composer-input">
					<ChatInput onsubmit={handleSubmit} />
				</div>
				<div class="composer-call">
					<CallControls
						active={voiceCall.active}
						muted={voiceCall.muted}
						status={voiceCall.status}
						disabled={!canCall}
						onstart={handleStartCall}
						onend={endCall}
						ontoggleMute={toggleMute}
					/>
				</div>
			</div>
		</div>
	</main>

	<NotesPanel />
</div>

<EventModal
	bind:open={eventModalOpen}
	item={selectedEvent}
	onask={askAgent}
	onclose={() => (selectedEvent = null)}
/>
<EmailModal
	bind:open={emailModalOpen}
	item={selectedEmail}
	onask={askAgent}
	onclose={() => (selectedEmail = null)}
/>

<style>
	.layout {
		display: flex;
		/* Fill the height-constrained (app) scroll wrapper. The parent .h-full is a
		   plain block, so `flex: 1` here is ignored — an explicit height is what
		   pins the column to the viewport so only the chat thread scrolls (header
		   + agenda stay fixed at top, ChatInput fixed at bottom). */
		height: 100%;
		min-height: 0;
		overflow: hidden;
		background: var(--color-bg);
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
		/* Drives the responsive collapse of the header actions (CallControls label,
		   greeting clamp) off the COLUMN width — so it reacts to the notes panel
		   opening, not just the viewport. */
		container-type: inline-size;
		container-name: agentcol;
	}

	/* Header: identity grows to fill, action cluster sits at its natural size on
	   the right. The identity is the only growing item, so the greeting always
	   gets the leftover width — it never gets starved into a smooshed column. */
	.greeting-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding-top: 10px;
		padding-bottom: 4px;
	}
	@media (min-width: 768px) {
		.greeting-row.notch-pad {
			padding-right: var(--notch-clearance);
		}
	}

	.identity {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1 1 auto;
		min-width: 0;
	}

	.greeting-text {
		flex: 1;
		min-width: 0;
	}

	/* Composer row: chat input grows, "Call agent" sits to its right, centered on
	   the input box (the +22px offset clears the input's top padding). */
	.composer {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}
	.composer-input {
		flex: 1;
		min-width: 0;
	}
	.composer-call {
		flex-shrink: 0;
		/* Clear ChatInput's 12px top padding so the call button's top edge lines up
		   with the input box (both are now 52px tall, 12px radius). */
		margin-top: 12px;
	}

	.mini-avatar {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border-radius: 50%;
		overflow: hidden;
		background: radial-gradient(circle at 50% 40%, #1b1408, #0c0a05 80%);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 55%, transparent);
	}

	/* Stage: avatar above agenda by default. */
	.stage {
		display: flex;
		flex-direction: column;
		gap: 16px;
		flex-shrink: 0;
	}

	/* The events/emails columns own their own 28vh scroll (FeedSection.scrollable),
	   so the agenda itself must NOT also scroll — an outer overflow here produced a
	   second scrollbar over the columns AND clipped the overflowing toggle handle.
	   It grows with its (self-bounded) content instead; the chat thread takes the
	   rest of the column height. */

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
		background: radial-gradient(
			circle at 50% 35%,
			color-mix(in srgb, var(--color-accent) 8%, transparent),
			transparent 70%
		);
		border: 1px solid var(--color-border);
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
		color: var(--color-muted);
		text-align: center;
		min-height: 18px;
	}
	.interim {
		display: block;
		color: var(--color-muted-foreground);
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

	/* Feed grid: events + emails as two columns while the agenda is a band at
	   the top. align-items:start so a short column doesn't stretch to match a
	   tall one. */
	/* Sleek day separators inside the Upcoming column. */
	.day-divider {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 4px 4px 13px;
	}
	.day-divider:first-child {
		padding-top: 2px;
	}
	.day-label {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--color-foreground) 60%, transparent);
		white-space: nowrap;
	}
	.day-rule {
		flex: 1;
		height: 1px;
		background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
	}
	.day-count {
		font-size: 10px;
		font-weight: 600;
		color: color-mix(in srgb, var(--color-foreground) 32%, transparent);
		font-variant-numeric: tabular-nums;
	}

	.feed-grid {
		display: grid;
		/* minmax(0, 1fr) — NOT 1fr — so the columns stay equal and the card
		   titles (white-space:nowrap) ellipsis-truncate instead of forcing the
		   email column wide on their min-content. */
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 0 20px;
		align-items: start;
		/* Breathing room above the section titles so they don't crowd the greeting. */
		padding-top: 14px;
	}

	/* A single present section (only events OR only emails) spans full width
	   rather than hugging the left half. */
	.feed-grid > :global(.feed-section:only-child) {
		grid-column: 1 / -1;
	}

	/* Vertical agenda (during a call): stack events over emails. */
	.stage.in-call .feed-grid {
		grid-template-columns: 1fr;
	}

	/* Narrow column (notes panel open / small viewport): stack as well — two
	   columns get too cramped under ~520px of column width. */
	@container agentcol (max-width: 520px) {
		.feed-grid {
			grid-template-columns: 1fr;
		}
	}

	/* Chat section grows to fill the space between the agenda and the input. */
	/* Butts directly against the feed group's bottom border (no margin/padding) so
	   the messages start right under it; the thread's top padding leaves exactly
	   the hanging toggle's lower half worth of clearance — no dead space. */
	.chat-section {
		flex: 1;
		min-height: 220px;
		display: flex;
		flex-direction: column;
		margin-top: 0;
		padding-top: 0;
	}

	.thread {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		scrollbar-width: thin;
		padding: 18px 2px 4px;
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
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 24%, transparent);
		color: var(--color-foreground);
		white-space: pre-wrap;
	}
	.bubble.assistant {
		background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
		border: 1px solid var(--color-border);
		color: var(--color-foreground);
	}
	.bubble.assistant.streaming {
		border-style: dashed;
		opacity: 0.9;
	}

	/* Dragged-context chips echoed above a sent user bubble — visually separate
	   from the typed text (the raw context block itself is never shown). */
	.sent-chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 5px;
		max-width: 85%;
		margin-bottom: 2px;
	}
	.sent-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 240px;
		padding: 2px 9px;
		border-radius: 999px;
		font-size: 11px;
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 26%, transparent);
		color: color-mix(in srgb, var(--color-foreground) 75%, transparent);
	}
	.sent-chip-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	/* "New chat" reset — quiet pill in the greeting row's top-right. */
	.new-chat {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);
		background: transparent;
		color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
		font-size: 12px;
		cursor: pointer;
		transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
	}
	.new-chat:hover:not(:disabled) {
		color: var(--color-foreground);
		border-color: color-mix(in srgb, var(--color-foreground) 24%, transparent);
		background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
	}
	.new-chat:disabled {
		opacity: 0.45;
		cursor: default;
	}
	@container agentcol (max-width: 460px) {
		.new-chat span {
			display: none;
		}
	}

	.bubble-time {
		font-size: 9px;
		color: var(--color-muted-foreground);
		padding: 0 4px;
		font-variant-numeric: tabular-nums;
	}

	.thinking-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-muted);
		padding: 4px 6px;
	}

	.thinking-row .dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--color-accent);
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
		color: var(--color-muted);
		padding: 8px 4px;
	}
	.state-note.error {
		color: var(--color-accent);
	}

	.retry {
		align-self: flex-start;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
		color: var(--color-accent);
		padding: 4px 10px;
		border-radius: var(--theme-radius, 4px);
		cursor: pointer;
		font-size: 12px;
	}

	/* The events/emails columns live inside this group; its bottom border IS the
	   divider, and the collapse handle hangs halfway out of it. */
	.feed-group {
		position: relative;
		/* Clear space below the columns (and the "+N more" row when collapsed) so the
		   hanging toggle doesn't crowd the content above the border. */
		padding-bottom: 14px;
		border-bottom: 1px solid color-mix(in srgb, var(--color-foreground) 13%, transparent);
	}

	/* Single feed collapse/expand handle — a small subtle pill pinned to the
	   group's bottom border, hanging half out (below) and half in (above). */
	.feed-toggle {
		position: absolute;
		left: 50%;
		bottom: 0;
		transform: translate(-50%, 50%);
		z-index: 2;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 46px;
		height: 18px;
		padding: 0;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 13%, transparent);
		background: var(--color-bg);
		color: color-mix(in srgb, var(--color-foreground) 38%, transparent);
		cursor: pointer;
		transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
	}
	.feed-toggle:hover {
		color: color-mix(in srgb, var(--color-foreground) 75%, transparent);
		border-color: color-mix(in srgb, var(--color-foreground) 22%, transparent);
		background: color-mix(in srgb, var(--color-foreground) 4%, var(--color-bg));
	}
	.feed-toggle :global(svg) {
		transition: transform 160ms ease;
	}
	.feed-toggle.open :global(svg) {
		transform: rotate(180deg);
	}

	/* "+N more" affordance shown under a collapsed section's single preview card —
	   right-aligned, small and subtle. */
	.more-row {
		align-self: flex-end;
		margin: 2px 4px 0 0;
		padding: 1px 4px;
		background: transparent;
		border: none;
		border-radius: 6px;
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: color-mix(in srgb, var(--color-foreground) 38%, transparent);
		cursor: pointer;
		transition: color 120ms ease;
	}
	.more-row:hover {
		color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
	}

	@media (max-width: 640px) {
		.stage.in-call {
			flex-direction: column;
		}
	}
</style>
