<script lang="ts">
	import NavRail from '$lib/components/my-agent/NavRail.svelte';
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
	import { notesState, loadNotes } from '$lib/state/features/agent-notes.svelte';
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
	import {
		getFeedToday,
		type ObservationRow,
		type CalendarItem,
		type EmailItem,
	} from '$lib/services/my-agent-rpc';
	import { createConnectedFetch } from '$lib/state/async.svelte';
	import { distinctProviders } from '$lib/components/my-agent/provider';
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
	// The lone visible chevron rides on whichever column renders first (events when
	// present, else emails), but both columns bind the same state.
	const toggleOnEvents = $derived(calendarItems.length > 0);

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

	type Block = { type?: string; [k: string]: unknown };
	function contentBlocks(m: ChatMessage | null | undefined): Block[] {
		return m && Array.isArray(m.content) ? (m.content as Block[]) : [];
	}
	function stringifyToolResult(content: unknown): string {
		if (typeof content === 'string') return content;
		if (Array.isArray(content)) {
			return (content as Block[])
				.map((p) => (p?.type === 'text' && typeof p.text === 'string' ? (p.text as string) : ''))
				.filter(Boolean)
				.join('\n');
		}
		try {
			return JSON.stringify(content, null, 2);
		} catch {
			return String(content ?? '');
		}
	}

	// tool_use_id → result, collected across the whole thread (results live in the
	// following user-role turn) so each tool card can show its outcome.
	const toolResultsById = $derived.by<Record<string, { content: string; isError: boolean }>>(() => {
		const map: Record<string, { content: string; isError: boolean }> = {};
		const scan = (m: ChatMessage | null | undefined) => {
			if (!m) return;
			// Gateway-native schema: a whole message with role 'toolResult'
			// (`{role:'toolResult', toolCallId, toolName, content:[{type:'text'}], isError}`).
			const mm = m as unknown as {
				role?: string;
				content?: unknown;
				toolCallId?: string;
				isError?: boolean;
			};
			if (mm.role === 'toolResult' && typeof mm.toolCallId === 'string') {
				map[mm.toolCallId] = {
					content: stringifyToolResult(mm.content),
					isError: !!mm.isError
				};
				return;
			}
			// Anthropic-style: tool_result blocks inside a (user-role) message.
			for (const b of contentBlocks(m)) {
				if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
					map[b.tool_use_id] = {
						content: stringifyToolResult(b.content),
						isError: !!b.is_error
					};
				}
			}
		};
		for (const m of messages) scan(m as ChatMessage);
		scan(streamMessage);
		return map;
	});

	// A message is "tool-result only" (a tool-output carrier turn) → folded into
	// the tool cards rather than shown as its own bubble.
	function isToolResultOnly(m: ChatMessage): boolean {
		// Gateway-native carrier: a whole message with role 'toolResult'.
		if ((m as { role?: string }).role === 'toolResult') return true;
		const blocks = contentBlocks(m);
		if (blocks.length === 0) return false;
		return blocks.every((b) => b?.type === 'tool_result');
	}
	function assistantHasContent(m: ChatMessage): boolean {
		if (typeof m.content === 'string') return m.content.trim().length > 0;
		return contentBlocks(m).some((b) =>
			['text', 'thinking', 'redacted_thinking', 'tool_use', 'toolCall', 'image', 'image_url'].includes(
				b?.type ?? ''
			)
		);
	}

	// Stable per-row key derived from content (NOT array index) — so reconciling
	// server history into the optimistic thread reuses DOM instead of re-mounting
	// every row (the old `${ts}_${i}` key was the "history flash" culprit).
	function rowKey(m: ChatMessage): string {
		const t = stripVoiceTurnPrefix(extractText(m) ?? '');
		const toolNames = contentBlocks(m)
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
	}
	const renderedMessages = $derived.by<RenderedRow[]>(() => {
		const seen = new Map<string, number>();
		const rows: RenderedRow[] = [];
		for (const raw of messages) {
			const m = raw as ChatMessage;
			if (isToolResultOnly(m)) continue;
			const role = msgRole(m);
			const text = stripVoiceTurnPrefix(extractText(m) ?? '');
			if (role === 'user' ? text.trim().length === 0 : !assistantHasContent(m)) continue;
			const base = rowKey(m);
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			rows.push({ key: `${base}#${n}`, msg: m, role, ts: msgTs(m), text });
		}
		return rows;
	});

	// Live status while a run streams: "Using <tool>…" / "Thinking…" / null (text
	// is streaming, shown directly). Drives the activity line under the thread.
	const streamActivity = $derived.by<string | null>(() => {
		if (!streamMessage) return null;
		const blocks = contentBlocks(streamMessage);
		if (blocks.length === 0) return 'Thinking…';
		const last = [...blocks].reverse().find((b) => b?.type);
		if (!last) return 'Thinking…';
		if (last.type === 'tool_use') return `Using ${(last.name as string) ?? 'a tool'}…`;
		if (last.type === 'thinking' || last.type === 'redacted_thinking') return 'Thinking…';
		return null; // text block streaming — the partial answer shows itself
	});

	// Whether the live streaming turn has any visible content yet (reasoning/tool
	// meta, or smoothed answer text being revealed).
	const streamHasContent = $derived(
		(!!streamMessage && assistantHasContent(streamMessage)) || streamDisplay.length > 0
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

				<div class="actions" role="group" aria-label="Agent actions">
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
					{:else if loading && feedEmpty}
						<p class="state-note">Loading…</p>
					{:else if errorMsg}
						<p class="state-note error">Feed failed: {errorMsg}</p>
						<button type="button" class="retry" onclick={loadFeed}>Retry</button>
					{:else if feedEmpty}
						<p class="state-note">
							Quiet so far today. As you exchange messages with your agents, they'll surface here.
						</p>
					{:else}
						<!-- Calendar events + emails sit side-by-side (events | emails) while the
						     agenda runs as a band at the top, and stack vertically when the
						     agenda becomes a narrow column during a call. A lone section (only
						     events OR only emails) spans the full width via :only-child. -->
						<div class="feed-grid">
							<!-- Upcoming calendar events (next 24h across linked Google calendars). -->
							{#if calendarItems.length > 0}
								<FeedSection
									label="Upcoming"
									count={calendarItems.length}
									providers={eventProviders}
									collapsible={toggleOnEvents}
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
													+{calendarItems.length - 1} more
												</button>
											{/if}
										{/if}
									{/snippet}
								</FeedSection>
							{/if}

							<!-- Inbox emails across linked Google identities. -->
							{#if emailItems.length > 0}
								<FeedSection
									label="Emails"
									count={emailItems.length}
									providers={emailProviders}
									collapsible={!toggleOnEvents}
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
													+{emailItems.length - 1} more
												</button>
											{/if}
										{/if}
									{/snippet}
								</FeedSection>
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
			<section class="chat-section" aria-label="Conversation">
				{#if renderedMessages.length > 0 || streamMessage || stream || sending}
					<div class="thread" bind:this={threadEl} onscroll={onThreadScroll}>
						<div class="thread-inner">
							{#each renderedMessages as row (row.key)}
								{#if row.role === 'assistant'}
									<!-- Assistant turn: ChatTurn owns its layout — quiet reasoning/tool
									     rows OUTSIDE the bubble, the reply inside its own bubble. -->
									<div class="bubble-row assistant">
										<ChatTurn message={row.msg} toolResults={toolResultsById} />
										{#if row.ts}<span class="bubble-time">{fmtTime(row.ts)}</span>{/if}
									</div>
								{:else}
									<div class="bubble-row user">
										<div class="bubble user">{row.text}</div>
										{#if row.ts}<span class="bubble-time">{fmtTime(row.ts)}</span>{/if}
									</div>
								{/if}
							{/each}

							<!-- Live streaming turn: reasoning/tool rows surface above the reply;
							     the answer text is the smoothed (typewriter) reveal via textOverride. -->
							{#if streamHasContent && streamMessage}
								<div class="bubble-row assistant">
									<ChatTurn
										message={streamMessage}
										toolResults={toolResultsById}
										streaming
										textOverride={streamDisplay}
									/>
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

			<ChatInput onsubmit={handleSubmit} />
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

	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
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

	/* Agenda stays compact by default, but expands with content (capped, scrolls).
	   The events/emails columns own their own 28vh scroll (FeedSection.scrollable),
	   so this outer cap mainly bounds the channel-observation groups below them. */
	.stage:not(.in-call) .agenda {
		max-height: 46vh;
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

	/* "+N more" affordance shown under a collapsed section's single preview card. */
	.more-row {
		align-self: flex-start;
		margin: 2px 0 2px 10px;
		padding: 2px 8px;
		background: transparent;
		border: none;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: color-mix(in srgb, var(--color-accent) 75%, transparent);
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease;
	}
	.more-row:hover {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		color: var(--color-accent);
	}

	@media (max-width: 640px) {
		.stage.in-call {
			flex-direction: column;
		}
	}
</style>
