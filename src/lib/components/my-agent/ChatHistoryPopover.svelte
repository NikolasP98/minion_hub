<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Popover } from '$lib/components/ui';
	import { sendRequest } from '$lib/services/gateway-rpc';
	import { History, MessageSquareText } from 'lucide-svelte';

	type HistorySession = {
		key: string;
		title: string;
		preview: string;
		updatedAt: number | null;
	};

	let {
		agentId,
		activeSessionKey,
		disabled = false,
		onselect,
	}: {
		agentId: string;
		activeSessionKey: string;
		disabled?: boolean;
		onselect: (sessionKey: string) => void | Promise<void>;
	} = $props();

	let open = $state(false);
	let loading = $state(false);
	let sessions = $state<HistorySession[]>([]);
	const titleRequests = new Set<string>();

	function fallbackTitle(key: string): string {
		const tail = key.replace(new RegExp(`^agent:${agentId}:`), '');
		return tail === 'main' ? m.chat_currentConversation() : tail.replaceAll(':', ' · ');
	}

	function relativeTime(ts: number | null): string {
		if (!ts) return '';
		const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;
		return `${Math.floor(hours / 24)}d`;
	}

	async function loadSessions() {
		if (loading) return;
		loading = true;
		try {
			const response = (await sendRequest('sessions.list', {
				agentId,
				limit: 100,
				includeDerivedTitles: true,
				includeLastMessage: true,
			})) as { sessions?: Array<Record<string, unknown>> };
			const rows = response.sessions ?? [];
			sessions = rows
				.map((row) => {
					const key = String(row.key ?? '');
					const displayName = String(row.displayName ?? '').trim();
					const derivedTitle = String(row.derivedTitle ?? '').trim();
					const topicTitle = derivedTitle && derivedTitle !== displayName ? derivedTitle : '';
					return {
						key,
						title: String(row.label ?? (topicTitle || fallbackTitle(key))),
						preview: String(row.lastMessagePreview ?? ''),
						updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : null,
					};
				})
				.filter((row) => row.key.startsWith(`agent:${agentId}:`))
				.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
			if (!sessions.some((session) => session.key === activeSessionKey)) {
				sessions = [
					{
						key: activeSessionKey,
						title: m.chat_currentConversation(),
						preview: '',
						updatedAt: Date.now(),
					},
					...sessions,
				];
			}

			// A deterministic first-prompt title paints immediately. Missing labels
			// are upgraded asynchronously by the cheap session-title drone and then
			// persisted on the gateway so every device sees the same title.
			for (const row of rows) {
				const key = String(row.key ?? '');
				const displayName = String(row.displayName ?? '').trim();
				const derivedTitle = String(row.derivedTitle ?? '').trim();
				const excerpt = [derivedTitle !== displayName ? derivedTitle : '', row.lastMessagePreview]
					.filter(Boolean)
					.join('\n');
				if (!key || row.label || !excerpt || titleRequests.has(key)) continue;
				titleRequests.add(key);
				void sendRequest('drones.session-title', { transcript: excerpt })
					.then((result) => {
						const title = (result as { title?: unknown })?.title;
						if (typeof title !== 'string' || !title.trim()) return;
						return sendRequest('sessions.patch', { key, label: title.trim() }).then(() => {
							const match = sessions.find((session) => session.key === key);
							if (match) match.title = title.trim();
						});
					})
					.catch(() => titleRequests.delete(key));
			}
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) void loadSessions();
	});

	async function choose(key: string) {
		await onselect(key);
		open = false;
	}
</script>

<Popover bind:open placement="bottom" bare {disabled}>
	{#snippet trigger()}
		<span class="history-trigger" class:disabled title={m.chat_history()} aria-label={m.chat_history()}>
			<span class="history-icon"><History size={15} /></span>
		</span>
	{/snippet}
	<div class="history-panel" aria-label={m.chat_history()}>
		<div class="history-head">
			<span>{m.chat_history()}</span>
			<span class="history-count">{sessions.length}</span>
		</div>
		<div class="history-list">
			{#if loading}
				<p class="history-state">{m.chat_historyLoading()}</p>
			{:else if sessions.length === 0}
				<p class="history-state">{m.chat_historyEmpty()}</p>
			{:else}
				{#each sessions as session (session.key)}
					<button
						type="button"
						class="history-row"
						class:active={session.key === activeSessionKey}
						onclick={() => choose(session.key)}
					>
						<span class="row-icon"><MessageSquareText size={14} /></span>
						<span class="history-copy">
							<strong>{session.title}</strong>
							{#if session.preview}<span>{session.preview}</span>{/if}
						</span>
						<time>{relativeTime(session.updatedAt)}</time>
					</button>
				{/each}
			{/if}
		</div>
	</div>
</Popover>

<style>
	.history-trigger { display: inline-flex; width: 32px; height: 32px; align-items: center; justify-content: center; border: 1px solid var(--color-border); border-radius: 9px; color: var(--color-muted-foreground); background: color-mix(in srgb, var(--color-canvas) 90%, transparent); transition: 140ms ease; }
	.history-trigger:hover { color: var(--color-foreground); border-color: color-mix(in srgb, var(--color-accent) 38%, var(--color-border)); background: color-mix(in srgb, var(--color-accent) 7%, var(--color-canvas)); }
	.history-trigger.disabled { pointer-events: none; opacity: .45; }
	.history-panel { position: relative; isolation: isolate; z-index: 100; width: min(360px, calc(100vw - 24px)); overflow: hidden; border: 1px solid var(--elevation-3-border); border-radius: 14px; background-color: var(--elevation-3-bg); box-shadow: var(--shadow-xl), 0 18px 45px rgb(0 0 0 / 18%); }
	.history-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 9px; border-bottom: 1px solid var(--color-border); font-size: 12px; font-weight: 650; }
	.history-count { min-width: 20px; padding: 1px 6px; border-radius: 999px; text-align: center; color: var(--color-muted-foreground); background: color-mix(in srgb, var(--color-foreground) 6%, transparent); font-size: 10px; }
	.history-list { max-height: min(390px, 55vh); overflow-y: auto; padding: 6px; }
	.history-state { margin: 0; padding: 28px 16px; text-align: center; color: var(--color-muted-foreground); font-size: 12px; }
	.history-row { display: grid; width: 100%; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 9px; align-items: start; padding: 9px; border: 0; border-radius: 9px; text-align: left; color: var(--color-foreground); background: transparent; cursor: pointer; }
	.history-row:hover, .history-row.active { background: color-mix(in srgb, var(--color-accent) 8%, transparent); }
	.history-row.active { box-shadow: inset 2px 0 var(--color-accent); }
	.history-icon { display: inline-flex; }
	.row-icon { display: inline-flex; margin-top: 2px; color: var(--color-muted-foreground); }
	.history-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
	.history-copy strong, .history-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.history-copy strong { font-size: 12px; font-weight: 600; }
	.history-copy span { color: var(--color-muted-foreground); font-size: 11px; }
	.history-row time { padding-top: 1px; color: var(--color-muted-foreground); font-size: 10px; font-variant-numeric: tabular-nums; }
</style>
