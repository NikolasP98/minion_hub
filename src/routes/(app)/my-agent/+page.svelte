<script lang="ts">
	import NavRail from '$lib/components/my-agent/NavRail.svelte';
	import AgentGreeting from '$lib/components/my-agent/AgentGreeting.svelte';
	import FeedSection from '$lib/components/my-agent/FeedSection.svelte';
	import FeedCard from '$lib/components/my-agent/FeedCard.svelte';
	import ChatInput from '$lib/components/my-agent/ChatInput.svelte';
	import { conn } from '$lib/state/gateway';
	import { getFeedToday, type ObservationRow } from '$lib/services/my-agent-rpc';
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

	function handleSubmit(text: string, mode: 'ask' | 'capture') {
		// PR-2 stub. A later PR wires this to myAgent.askChat / capture RPC.
		console.info('[my-agent] submit', mode, text);
	}
</script>

<svelte:head>
	<title>My Agent · Minion</title>
</svelte:head>

<div class="layout">
	<NavRail />

	<main class="column" aria-labelledby="my-agent-greeting">
		<div class="inner">
			<AgentGreeting greeting={data.greeting} userName={data.userName} />

			{#if !conn.connected}
				<p class="state-note">Connect a gateway to see your feed.</p>
			{:else if loading && observations.length === 0}
				<p class="state-note">Loading…</p>
			{:else if errorMsg}
				<p class="state-note error">Feed failed: {errorMsg}</p>
				<button type="button" class="retry" onclick={loadFeed}>Retry</button>
			{:else if observations.length === 0}
				<p class="state-note">Quiet so far today. As you exchange messages with your agents, they'll surface here.</p>
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

			<div class="history">
				<hr />
				<p class="history-note">Yesterday and earlier · history tray lands in a later phase</p>
			</div>

			<ChatInput onsubmit={handleSubmit} />
		</div>
	</main>
</div>

<style>
	.layout {
		display: flex;
		min-height: 100%;
		background: var(--color-bg, #0d0d0d);
	}

	.column {
		flex: 1;
		min-width: 0;
		display: flex;
		justify-content: center;
	}

	.inner {
		width: 100%;
		max-width: 720px;
		padding: 0 24px;
		display: flex;
		flex-direction: column;
		min-height: 100%;
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
		margin-top: 24px;
		flex: 1;
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
</style>
