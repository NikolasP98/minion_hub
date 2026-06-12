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
		User,
	} from 'lucide-svelte';
	import type { EmailItem } from '$lib/services/my-agent-rpc';

	interface Props {
		item: EmailItem | null;
		open?: boolean;
		onclose?: () => void;
		/**
		 * Hand a well-formed request to the agent (which holds gws gmail tools).
		 * Used for reply / forward / archive / delete / label until one-click
		 * gateway RPCs land (Phase 2).
		 */
		onask?: (prompt: string) => void;
	}

	let { item, open = $bindable(false), onclose, onask }: Props = $props();

	const sender = $derived(item?.fromName?.trim() || item?.from?.trim() || 'Unknown sender');
	const subject = $derived(item?.subject?.trim() || '(no subject)');
	const snippet = $derived(item?.snippet?.trim() || '');

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

	function ask(prompt: string) {
		onask?.(prompt);
		open = false;
		onclose?.();
	}

	function openInGmail() {
		if (item?.htmlLink) window.open(item.htmlLink, '_blank', 'noopener');
	}
</script>

<Modal bind:open title={subject} size="lg" {onclose}>
	{#if item}
		<div class="body">
			<div class="from">
				<span class="avatar" aria-hidden="true"><User size={16} /></span>
				<div class="from-text">
					<span class="name">{sender}</span>
					{#if item.from && item.from !== sender}<span class="addr">{item.from}</span>{/if}
				</div>
				{#if receivedLabel}<span class="when">{receivedLabel}</span>{/if}
			</div>

			{#if snippet}
				<p class="preview">{snippet}</p>
			{:else}
				<p class="preview muted">
					No preview available — open in Gmail or ask the agent to summarize the full message.
				</p>
			{/if}

			<!-- AI-assisted reply: the agent reads the thread (gws) and drafts a reply. -->
			<div class="ai-actions">
				<button
					type="button"
					class="ai-btn"
					onclick={() => ask(`Draft a reply to this ${ref}. Match my usual tone and show me the draft before sending.`)}
				>
					<Sparkles size={14} /> AI reply
				</button>
				<button
					type="button"
					class="ai-btn"
					onclick={() => ask(`Summarize this ${ref} and tell me if it needs action.`)}
				>
					<Sparkles size={14} /> Summarize
				</button>
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<button type="button" class="act" onclick={() => ask(`Reply to this ${ref}.`)}>
			<Reply size={14} /> Reply
		</button>
		<button type="button" class="act" onclick={() => ask(`Reply-all to this ${ref}.`)}>
			<ReplyAll size={14} /> Reply all
		</button>
		<button type="button" class="act" onclick={() => ask(`Forward this ${ref}. Ask me the recipient.`)}>
			<Forward size={14} /> Forward
		</button>
		<button type="button" class="act" onclick={() => ask(`Add a label to this ${ref}. Ask me which label.`)}>
			<Tag size={14} /> Label
		</button>
		<button type="button" class="act" onclick={() => ask(`Archive this ${ref}.`)}>
			<Archive size={14} /> Archive
		</button>
		<button type="button" class="act danger" onclick={() => ask(`Move this ${ref} to trash. Confirm with me first.`)}>
			<Trash2 size={14} /> Delete
		</button>
		{#if item?.htmlLink}
			<button type="button" class="act" onclick={openInGmail}>
				<ExternalLink size={14} /> Open
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
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
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
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
	.preview {
		margin: 0;
		font-size: 14px;
		line-height: 1.55;
		color: var(--color-foreground);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.preview.muted {
		color: var(--color-muted);
		font-style: italic;
	}
	.ai-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		padding-top: 4px;
		border-top: 1px solid var(--color-border);
	}
	.ai-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		color: var(--color-accent);
		cursor: pointer;
		transition: background 120ms ease;
		margin-top: 10px;
	}
	.ai-btn:hover {
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
	}

	.act {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		padding: 6px 12px;
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
	.act.danger {
		color: #f87171;
		border-color: color-mix(in srgb, #f87171 40%, transparent);
	}
	.act.danger:hover {
		background: color-mix(in srgb, #f87171 12%, transparent);
	}
</style>
