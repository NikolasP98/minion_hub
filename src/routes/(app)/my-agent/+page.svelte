<script lang="ts">
	import NavRail from '$lib/components/my-agent/NavRail.svelte';
	import AgentGreeting from '$lib/components/my-agent/AgentGreeting.svelte';
	import FeedSection from '$lib/components/my-agent/FeedSection.svelte';
	import FeedCard from '$lib/components/my-agent/FeedCard.svelte';
	import ChatInput from '$lib/components/my-agent/ChatInput.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	function handleSubmit(text: string, mode: 'ask' | 'capture') {
		// Phase 1 stub. Phase 2 wires this to `myAgent.askChat` / capture RPC.
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

			{#each data.sections as section (section.kind)}
				{#if section.items.length > 0}
					<FeedSection label={section.label} count={section.items.length}>
						{#each section.items as item (item.id)}
							<FeedCard
								title={item.title}
								subtitle={item.subtitle}
								icon={item.icon}
								onreply={section.kind === 'thread' ? () => handleSubmit(`Reply to ${item.title}`, 'ask') : undefined}
								onsnooze={() => {}}
								ondismiss={() => {}}
								onopen={() => {}}
							/>
						{/each}
					</FeedSection>
				{/if}
			{/each}

			{#if data.moreFromTodayCount > 0}
				<button type="button" class="collapsible">
					More from today · {data.moreFromTodayCount}
				</button>
			{/if}

			{#if data.whatINoticedCount > 0}
				<button type="button" class="collapsible">
					What I noticed · {data.whatINoticedCount}
				</button>
			{/if}

			<div class="history">
				<hr />
				<p class="history-note">Yesterday and earlier · history tray lands in Phase 2</p>
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

	.collapsible {
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.35);
		font-size: 12px;
		text-align: left;
		padding: 12px 4px;
		cursor: pointer;
		border-top: 1px solid rgba(255, 255, 255, 0.04);
	}

	.collapsible:hover {
		color: rgba(255, 255, 255, 0.6);
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
