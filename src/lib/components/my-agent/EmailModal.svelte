<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import {
		Reply,
		ReplyAll,
		Forward,
		Archive,
		Trash2,
		Tag,
		ExternalLink,
		Sparkles,
		Send,
		RefreshCw,
		Loader2,
		X,
	} from 'lucide-svelte';
	import type { EmailItem } from '$lib/services/my-agent-rpc';
	import {
		getEmailBody,
		getEmailSummary,
		draftEmailReply as rpcDraftReply,
	} from '$lib/services/my-agent-rpc';

	interface Props {
		item: EmailItem | null;
		open?: boolean;
		onclose?: () => void;
		/**
		 * Hand a well-formed request to the agent (which holds gws gmail tools).
		 * Used for the mutating actions (forward / archive / label / trash) and
		 * for the final "send" of an in-modal composed reply.
		 */
		onask?: (prompt: string) => void;
	}

	let { item, open = $bindable(false), onclose, onask }: Props = $props();

	const sender = $derived(item?.fromName?.trim() || item?.from?.trim() || 'Unknown sender');
	const subject = $derived(item?.subject?.trim() || '(no subject)');
	const initial = $derived(sender.charAt(0).toUpperCase() || '?');

	const receivedLabel = $derived.by(() => {
		if (!item?.receivedAt) return '';
		const d = new Date(item.receivedAt);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleString([], {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	});

	// A quoted reference block so the agent knows exactly which message to act on.
	const ref = $derived(
		`Email — from: ${sender}, subject: "${subject}"${receivedLabel ? `, received: ${receivedLabel}` : ''}`,
	);

	// ─── Body + summary lifecycle ─────────────────────────────────────────────
	// Both fire when a message opens. The gateway shares one gws spawn between
	// body + summary (short-TTL cache) and caches the summary per message, so
	// re-opening the same email costs nothing.
	let body = $state('');
	let bodyLoading = $state(false);
	let bodyError = $state(false);
	let summary = $state<string | null>(null);
	let summaryLoading = $state(false);

	// Track which message we've loaded so the effect only fires on a real change.
	let loadedId = $state<string | null>(null);

	$effect(() => {
		if (!open || !item) {
			return;
		}
		if (item.id === loadedId) {
			return;
		}
		loadedId = item.id;
		void loadDetail(item.id, item.sourceEmail);
	});

	async function loadDetail(messageId: string, sourceEmail: string) {
		// Reset composer + panels for the freshly-opened message.
		resetComposer();
		body = '';
		bodyError = false;
		summary = null;
		bodyLoading = true;
		summaryLoading = true;

		// Fire both in parallel; they de-dupe the gws read on the gateway side.
		const bodyP = getEmailBody(messageId, sourceEmail)
			.then((res) => {
				// Guard against a late response after the user switched messages.
				if (loadedId !== messageId) return;
				body = res.body;
				bodyError = res.body.trim().length === 0;
			})
			.catch(() => {
				if (loadedId !== messageId) return;
				bodyError = true;
			})
			.finally(() => {
				if (loadedId === messageId) bodyLoading = false;
			});

		const sumP = getEmailSummary(messageId, sourceEmail)
			.then((s) => {
				if (loadedId !== messageId) return;
				summary = s;
			})
			.catch(() => {
				/* summary is best-effort; silent */
			})
			.finally(() => {
				if (loadedId === messageId) summaryLoading = false;
			});

		await Promise.allSettled([bodyP, sumP]);
	}

	// ─── In-modal reply composer ──────────────────────────────────────────────
	// "reply" / "replyAll" open a draft right here (no chat round-trip). The draft
	// is AI-generated and fully editable before the user commits to sending.
	type ComposeMode = 'reply' | 'replyAll';
	let composeMode = $state<ComposeMode | null>(null);
	let draft = $state('');
	let draftLoading = $state(false);
	let steer = $state('');

	function resetComposer() {
		composeMode = null;
		draft = '';
		steer = '';
		draftLoading = false;
	}

	async function startReply(mode: ComposeMode) {
		if (!item) return;
		composeMode = mode;
		draft = '';
		draftLoading = true;
		try {
			const d = await rpcDraftReply(item.id, { sourceEmail: item.sourceEmail });
			draft = d ?? '';
		} catch {
			draft = '';
		} finally {
			draftLoading = false;
		}
	}

	async function regenerate() {
		if (!item) return;
		draftLoading = true;
		try {
			const d = await rpcDraftReply(item.id, {
				sourceEmail: item.sourceEmail,
				instructions: steer.trim() || undefined,
			});
			if (d) draft = d;
		} catch {
			/* keep current draft */
		} finally {
			draftLoading = false;
		}
	}

	function sendDraft() {
		const text = draft.trim();
		if (!text) return;
		const verb = composeMode === 'replyAll' ? 'Reply-all to' : 'Reply to';
		// The composed/edited text is final — the agent just sends it via gws.
		ask(
			`${verb} this ${ref} with exactly this body (do not rewrite it, send as-is):\n\n${text}`,
		);
	}

	function ask(prompt: string) {
		onask?.(prompt);
		open = false;
		onclose?.();
	}

	function openInGmail() {
		if (item?.htmlLink) window.open(item.htmlLink, '_blank', 'noopener');
	}
</script>

<Modal bind:open size="lg" {onclose}>
	{#snippet header()}
		<div class="hdr">
			<h2 class="hdr-title" title={subject}>{subject}</h2>
			{#if item?.htmlLink}
				<button
					type="button"
					class="hdr-open"
					onclick={openInGmail}
					title="Open in Gmail"
					aria-label="Open in Gmail"
				>
					<ExternalLink size={14} />
				</button>
			{/if}
		</div>
	{/snippet}

	{#if item}
		<div class="body">
			<div class="from">
				<span class="avatar" aria-hidden="true">{initial}</span>
				<div class="from-text">
					<span class="name">{sender}</span>
					{#if item.from && item.from !== sender}<span class="addr">{item.from}</span>{/if}
				</div>
				{#if receivedLabel}<span class="when">{receivedLabel}</span>{/if}
			</div>

			<!-- AI summary banner — auto-generated on open, cached server-side. -->
			{#if summaryLoading}
				<div class="summary loading">
					<Sparkles size={13} />
					<span class="shimmer">Summarizing…</span>
				</div>
			{:else if summary}
				<div class="summary">
					<Sparkles size={13} class="sum-ic" />
					<p>{summary}</p>
				</div>
			{/if}

			<!-- Real decoded message body -->
			<div class="content">
				{#if bodyLoading}
					<div class="loading-body">
						<Loader2 size={16} class="spin" />
						<span>Loading message…</span>
					</div>
				{:else if bodyError || !body}
					<p class="empty">
						Couldn't load the message body. Open in Gmail to read the full email.
					</p>
				{:else}
					<pre class="msg">{body}</pre>
				{/if}
			</div>

			<!-- In-modal composer: the draft lives + is edited here, never in chat. -->
			{#if composeMode}
				<div class="composer">
					<div class="composer-head">
						<span class="composer-title">
							{composeMode === 'replyAll' ? 'Reply all' : 'Reply'} to {sender}
						</span>
						<button type="button" class="composer-x" onclick={resetComposer} aria-label="Discard draft">
							<X size={14} />
						</button>
					</div>
					{#if draftLoading && !draft}
						<div class="loading-body">
							<Loader2 size={16} class="spin" />
							<span>Drafting a reply…</span>
						</div>
					{:else}
						<textarea
							class="draft"
							bind:value={draft}
							rows="6"
							placeholder="Your reply…"
						></textarea>
						<div class="composer-tools">
							<input
								class="steer"
								bind:value={steer}
								placeholder="Steer the draft (e.g. 'shorter, more formal')…"
								onkeydown={(e) => e.key === 'Enter' && regenerate()}
							/>
							<button
								type="button"
								class="ghost-btn"
								onclick={regenerate}
								disabled={draftLoading}
								title="Regenerate draft"
							>
								{#if draftLoading}<Loader2 size={14} class="spin" />{:else}<RefreshCw size={14} />{/if}
								Redraft
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		{#if composeMode}
			<button type="button" class="act" onclick={resetComposer}>Cancel</button>
			<button
				type="button"
				class="act send"
				onclick={sendDraft}
				disabled={!draft.trim() || draftLoading}
			>
				<Send size={14} /> Send
			</button>
		{:else}
			<div class="footer-actions">
				<button type="button" class="icon-act" onclick={() => startReply('reply')} title="Reply" aria-label="Reply">
					<Reply size={16} />
				</button>
				<button type="button" class="icon-act" onclick={() => startReply('replyAll')} title="Reply all" aria-label="Reply all">
					<ReplyAll size={16} />
				</button>
				<button
					type="button"
					class="icon-act"
					onclick={() => ask(`Forward this ${ref}. Ask me the recipient.`)}
					title="Forward"
					aria-label="Forward"
				>
					<Forward size={16} />
				</button>
				<span class="divider"></span>
				<button
					type="button"
					class="icon-act"
					onclick={() => ask(`Add a label to this ${ref}. Ask me which label.`)}
					title="Label"
					aria-label="Label"
				>
					<Tag size={16} />
				</button>
				<button
					type="button"
					class="icon-act"
					onclick={() => ask(`Archive this ${ref}.`)}
					title="Archive"
					aria-label="Archive"
				>
					<Archive size={16} />
				</button>
				<button
					type="button"
					class="icon-act danger"
					onclick={() => ask(`Move this ${ref} to trash. Confirm with me first.`)}
					title="Delete"
					aria-label="Delete"
				>
					<Trash2 size={16} />
				</button>
			</div>
		{/if}
	{/snippet}
</Modal>

<style>
	/* Header (corner Open icon) */
	.hdr {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.hdr-title {
		flex: 1;
		min-width: 0;
		font-size: 15px;
		font-weight: 650;
		color: var(--color-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hdr-open {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-md, 6px);
		border: none;
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		opacity: 0.55;
		transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
	}
	.hdr-open:hover {
		opacity: 1;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.from {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.avatar {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 15px;
		font-weight: 600;
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
	}
	.from-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.name {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.addr {
		font-size: 12px;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--color-muted-foreground);
	}

	/* AI summary banner */
	.summary {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		padding: 10px 12px;
		border-radius: var(--radius-md, 8px);
		background: color-mix(in srgb, var(--color-accent) 7%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 22%, transparent);
		color: var(--color-foreground);
	}
	.summary :global(.sum-ic) {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--color-accent);
	}
	.summary p {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
	}
	.summary.loading {
		align-items: center;
		color: var(--color-accent);
		font-size: 13px;
	}
	.shimmer {
		opacity: 0.75;
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 0.85; }
	}

	/* Message body */
	.content {
		min-height: 40px;
	}
	.msg {
		margin: 0;
		font-family: inherit;
		font-size: 14px;
		line-height: 1.6;
		color: var(--color-foreground);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 42vh;
		overflow-y: auto;
	}
	.empty {
		margin: 0;
		font-size: 13px;
		color: var(--color-muted);
		font-style: italic;
	}
	.loading-body {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--color-muted-foreground);
		padding: 6px 0;
	}
	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Composer */
	.composer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-radius: var(--radius-md, 8px);
		border: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
	}
	.composer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.composer-title {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted-foreground);
	}
	.composer-x {
		display: inline-flex;
		border: none;
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
	}
	.composer-x:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
	}
	.draft {
		width: 100%;
		resize: vertical;
		font-family: inherit;
		font-size: 14px;
		line-height: 1.55;
		padding: 10px 12px;
		border-radius: var(--radius-md, 6px);
		border: 1px solid var(--color-border);
		background: var(--color-background, transparent);
		color: var(--color-foreground);
	}
	.draft:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
	}
	.composer-tools {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.steer {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		padding: 6px 10px;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-foreground);
	}
	.steer:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
	}
	.ghost-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
		font-size: 12px;
		padding: 6px 10px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
		background: transparent;
		color: var(--color-accent);
		cursor: pointer;
	}
	.ghost-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
	.ghost-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* Footer */
	.footer-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-right: auto; /* left-align icon cluster */
	}
	.icon-act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-md, 8px);
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
	}
	.icon-act:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 7%, transparent);
		border-color: var(--color-border);
	}
	.icon-act.danger:hover {
		color: #f87171;
		background: color-mix(in srgb, #f87171 12%, transparent);
		border-color: color-mix(in srgb, #f87171 40%, transparent);
	}
	.divider {
		width: 1px;
		height: 20px;
		margin: 0 4px;
		background: var(--color-border);
	}
	.act {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		padding: 7px 14px;
		border-radius: var(--theme-radius, 6px);
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-foreground);
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.act:hover {
		background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
	}
	.act.send {
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-accent);
	}
	.act.send:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
	}
	.act.send:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
