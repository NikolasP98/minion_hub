<script lang="ts">
	import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
	import { Brain, Wrench, Loader, Check, TriangleAlert } from 'lucide-svelte';
	import type { ChatMessage } from '$lib/types/chat';

	interface ToolResult {
		content: string;
		isError: boolean;
	}

	interface Props {
		message: ChatMessage;
		/** tool_use_id → result, collected across the whole thread by the parent. */
		toolResults?: Record<string, ToolResult>;
		/** True while this turn is still streaming (affects tool/“thinking” labels). */
		streaming?: boolean;
		/**
		 * When set, render THIS text as the answer instead of the message's own
		 * text blocks — used during streaming to show the smoothed (typewriter)
		 * reveal while reasoning/tool meta still come from `message`.
		 */
		textOverride?: string;
	}

	const { message, toolResults = {}, streaming = false, textOverride }: Props = $props();

	type Block =
		| { kind: 'text'; text: string }
		| { kind: 'thinking'; text: string }
		| { kind: 'tool'; id: string; name: string; input: unknown }
		| { kind: 'image' };

	// Normalise the Anthropic-style content array into a flat render list.
	const blocks = $derived.by<Block[]>(() => {
		const c = message.content;
		if (typeof c === 'string') return c.trim() ? [{ kind: 'text', text: c }] : [];
		if (!Array.isArray(c)) return [];
		const out: Block[] = [];
		for (const b of c as Array<Record<string, unknown>>) {
			if (!b || typeof b !== 'object') continue;
			const t = b.type;
			if (t === 'text' && typeof b.text === 'string') {
				if (b.text.trim()) out.push({ kind: 'text', text: b.text });
			} else if (t === 'thinking' || t === 'redacted_thinking') {
				const txt =
					typeof b.thinking === 'string'
						? b.thinking
						: typeof b.text === 'string'
							? b.text
							: t === 'redacted_thinking'
								? '(reasoning hidden)'
								: '';
				if (txt) out.push({ kind: 'thinking', text: txt });
			} else if (t === 'tool_use') {
				out.push({
					kind: 'tool',
					id: typeof b.id === 'string' ? b.id : '',
					name: typeof b.name === 'string' ? b.name : 'tool',
					input: b.input
				});
			} else if (t === 'image' || t === 'image_url') {
				out.push({ kind: 'image' });
			}
			// tool_result blocks are folded into the matching tool card via `toolResults`.
		}
		return out;
	});

	// Reasoning + tool activity render OUTSIDE the answer bubble (so a sequence of
	// tool calls reads as a quiet list above the reply); text/images are the reply.
	const metaBlocks = $derived(blocks.filter((b) => b.kind === 'thinking' || b.kind === 'tool'));
	const bodyBlocks = $derived(blocks.filter((b) => b.kind === 'text' || b.kind === 'image'));

	function fmtInput(input: unknown): string {
		if (input === undefined || input === null) return '';
		if (typeof input === 'string') return input;
		try {
			return JSON.stringify(input, null, 2);
		} catch {
			return String(input);
		}
	}
	function preview(input: unknown): string {
		const s = typeof input === 'string' ? input : fmtInput(input).replace(/\s+/g, ' ');
		return s.length > 56 ? s.slice(0, 56) + '…' : s;
	}
</script>

<div class="turn">
	{#each metaBlocks as block, i (i)}
		{#if block.kind === 'thinking'}
			<details class="meta">
				<summary>
					<Brain size={12} class="mi" />
					<span class="label">{streaming ? 'Thinking…' : 'Reasoning'}</span>
				</summary>
				<div class="meta-body reason">{block.text}</div>
			</details>
		{:else if block.kind === 'tool'}
			{@const result = block.id ? toolResults[block.id] : undefined}
			{@const pending = streaming && !result}
			<details class="meta">
				<summary>
					<Wrench size={12} class="mi" />
					<span class="label tool-name">{block.name}</span>
					{#if preview(block.input)}<span class="tool-arg">{preview(block.input)}</span>{/if}
					<span class="tool-status" class:err={result?.isError}>
						{#if pending}
							<Loader size={11} class="spin" />
						{:else if result?.isError}
							<TriangleAlert size={11} />
						{:else if result}
							<Check size={11} />
						{/if}
					</span>
				</summary>
				<div class="meta-body">
					{#if fmtInput(block.input)}
						<div class="sect">Input</div>
						<pre class="pre">{fmtInput(block.input)}</pre>
					{/if}
					{#if result}
						<div class="sect">{result.isError ? 'Error' : 'Result'}</div>
						<pre class="pre" class:err={result.isError}>{result.content}</pre>
					{:else if pending}
						<div class="pending">Running…</div>
					{/if}
				</div>
			</details>
		{/if}
	{/each}

	{#if textOverride !== undefined}
		{#if textOverride.length > 0}
			<div class="answer" class:streaming>
				<MarkdownMessage value={textOverride} tone="assistant" />
			</div>
		{/if}
	{:else if bodyBlocks.length > 0}
		<div class="answer" class:streaming>
			{#each bodyBlocks as block, i (i)}
				{#if block.kind === 'text'}
					<MarkdownMessage value={block.text} tone="assistant" />
				{:else if block.kind === 'image'}
					<div class="img-chip">🖼 Image</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.turn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		width: 100%;
		min-width: 0;
	}

	/* ── Reasoning + tool rows: deliberately quiet, no card chrome ── */
	details.meta {
		border: none;
		background: none;
		max-width: 100%;
		min-width: 0;
	}
	summary {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 7px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 11.5px;
		color: rgba(255, 255, 255, 0.32);
		list-style: none;
		user-select: none;
		transition: color 160ms ease;
		min-width: 0;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:hover {
		color: rgba(255, 255, 255, 0.72);
	}
	/* Subtle "shine" sweep on hover. */
	summary::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(
			100deg,
			transparent 30%,
			rgba(255, 255, 255, 0.07) 50%,
			transparent 70%
		);
		transform: translateX(-120%);
	}
	summary:hover::after {
		animation: meta-shine 0.9s ease;
	}
	@keyframes meta-shine {
		to {
			transform: translateX(120%);
		}
	}
	summary :global(.mi) {
		flex-shrink: 0;
		opacity: 0.6;
	}
	.label {
		flex-shrink: 0;
	}
	.tool-name {
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}
	.tool-arg {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.7;
	}
	.tool-status {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		margin-left: 4px;
		color: rgba(255, 255, 255, 0.4);
	}
	.tool-status.err {
		color: #e0917f;
	}
	.tool-status :global(.spin) {
		animation: ct-spin 0.8s linear infinite;
	}
	@keyframes ct-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.meta-body {
		padding: 2px 9px 8px 24px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.meta-body.reason {
		font-size: 12px;
		line-height: 1.55;
		color: rgba(255, 255, 255, 0.5);
		white-space: pre-wrap;
		font-style: italic;
	}
	.sect {
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgba(255, 255, 255, 0.3);
		margin-top: 2px;
	}
	.pre {
		margin: 0;
		padding: 6px 8px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.28);
		font-size: 11px;
		line-height: 1.45;
		font-family: ui-monospace, monospace;
		color: rgba(255, 255, 255, 0.72);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 220px;
		overflow: auto;
		scrollbar-width: thin;
	}
	.pre.err {
		color: #f0a99a;
	}
	.pending {
		font-size: 11px;
		color: rgba(255, 255, 255, 0.4);
		font-style: italic;
	}

	/* ── The answer bubble (text only) ── */
	.answer {
		max-width: 85%;
		border-radius: 12px;
		padding: 8px 12px;
		font-size: 13px;
		line-height: 1.5;
		color: rgba(255, 255, 255, 0.9);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		word-break: break-word;
	}
	.answer.streaming {
		border-style: dashed;
		opacity: 0.92;
	}

	.img-chip {
		display: inline-block;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.55);
		padding: 4px 8px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 7px;
	}
</style>
