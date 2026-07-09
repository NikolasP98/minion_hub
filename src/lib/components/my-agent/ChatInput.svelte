<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { X } from 'lucide-svelte';
	import {
		readDragContext,
		hasDragContext,
		dragContextIcon,
		type DragContext,
	} from '$lib/utils/drag-context';
	import { createHotkeysAttachment } from '$lib/hotkeys';

	interface Props {
		onsubmit?: (text: string, mode: 'ask' | 'capture') => void;
		placeholder?: string;
	}

	const { onsubmit, placeholder = m.chat_askYourAgent() }: Props = $props();

	let value = $state('');
	let focused = $state(false);
	let textarea = $state<HTMLTextAreaElement | null>(null);

	// Context chips dragged in from the feed / notes panel. Their `text` blocks are
	// folded into the prompt on send so the agent gets the full reference.
	let chips = $state<DragContext[]>([]);
	let dragOver = $state(false);

	// Mode is `capture` if the user holds modifier or prefixes with #.
	const mode = $derived<'ask' | 'capture'>(value.trimStart().startsWith('#') ? 'capture' : 'ask');

	function removeChip(i: number) {
		chips = chips.filter((_, idx) => idx !== i);
	}

	// Build the outgoing message: dragged context blocks first, then the typed
	// text. Each block is wrapped in a labelled marker so the transcript can be
	// parsed back into chips for display (see parseUserContext in chat-rpc).
	// Labels must stay bracket-free — the gateway flattens newlines when it
	// records the turn, so `]` is the only reliable label terminator.
	function composed(text: string): string {
		if (chips.length === 0) return text;
		const ctx = chips
			.map((c) => {
				const label = c.label.replace(/\[/g, '(').replace(/\]/g, ')');
				return `[Context ${c.kind}: ${label}]\n${c.text}\n[/Context]`;
			})
			.join('\n\n');
		return text ? `${ctx}\n\n${text}` : ctx;
	}

	function send(effectiveMode: 'ask' | 'capture') {
		const text = value.trim();
		// Allow sending with only dragged context (no typed text).
		if (!text && chips.length === 0) return;
		onsubmit?.(composed(text), effectiveMode);
		value = '';
		chips = [];
	}

	// Enter sends in the current mode (# prefix → capture); Mod+Enter forces
	// capture. Shift+Enter falls through to a native newline.
	const composeKeys = createHotkeysAttachment(
		[
			{ hotkey: 'Enter', callback: () => send(mode) },
			{ hotkey: 'Mod+Enter', callback: () => send('capture') },
		],
		{ ignoreInputs: false },
	);

	function onDragOver(e: DragEvent) {
		if (!hasDragContext(e)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		dragOver = true;
	}
	function onDragLeave() {
		dragOver = false;
	}
	function onDrop(e: DragEvent) {
		const ctx = readDragContext(e);
		if (!ctx) return;
		e.preventDefault();
		dragOver = false;
		chips = [...chips, ctx];
		textarea?.focus();
	}

	function autoGrow() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		const max = focused ? 96 : 52;
		textarea.style.height = Math.min(textarea.scrollHeight, max) + 'px';
	}

	$effect(() => {
		// value subscription triggers re-grow
		value;
		autoGrow();
	});
</script>

<div class="chat-input-wrap">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="chat-input"
		class:focused
		class:drag-over={dragOver}
		data-mode={mode}
		ondragover={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
	>
		{#if chips.length > 0}
			<div class="chips">
				{#each chips as chip, i (i)}
					<span class="chip" title={chip.text}>
						<span class="chip-ic" aria-hidden="true">{dragContextIcon(chip.kind)}</span>
						<span class="chip-label">{chip.label}</span>
						<button
							type="button"
							class="chip-x"
							aria-label={m.chat_removeContext()}
							onclick={() => removeChip(i)}
						>
							<X size={11} />
						</button>
					</span>
				{/each}
			</div>
		{/if}
		<div class="input-row">
			<span class="prompt" aria-hidden="true">❯</span>
			<textarea
				bind:this={textarea}
				bind:value
				onfocus={() => (focused = true)}
				onblur={() => (focused = false)}
				{@attach composeKeys}
				oninput={autoGrow}
				placeholder={chips.length > 0 ? m.chat_addNoteOrSend() : placeholder}
				rows="1"
				aria-label={m.chat_chatWithYourAgent()}
			></textarea>
			<span class="kbd" aria-hidden="true">↵</span>
		</div>
		{#if dragOver}
			<span class="drop-hint" aria-hidden="true">{m.chat_dropToAddContext()}</span>
		{/if}
	</div>
</div>

<style>
	.chat-input-wrap {
		flex-shrink: 0;
		padding: 12px 0 16px;
		background: var(--color-bg);
	}

	/* TUI feel: the box blends into the page background (no raised fill); a thin
	   subtle outline + a terminal-style accent prompt do the framing. */
	.chat-input {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 8px;
		padding: 12px 16px;
		min-height: 52px;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
		border-left-width: 2px;
		border-radius: 12px;
		transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
	}

	.chat-input.focused {
		background: color-mix(in srgb, var(--color-foreground) 2.5%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 22%, transparent);
	}

	/* Terminal prompt glyph. */
	.prompt {
		flex-shrink: 0;
		font-family: ui-monospace, 'SF Mono', monospace;
		font-size: 14px;
		line-height: 1.5;
		color: color-mix(in srgb, var(--color-accent) 80%, transparent);
		user-select: none;
	}

	.chat-input.drag-over {
		border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 6%, var(--color-bg2));
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* Dragged-in context chips. */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 220px;
		padding: 3px 6px 3px 8px;
		border-radius: 999px;
		font-size: 12px;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		color: var(--color-foreground);
	}
	.chip-ic {
		flex-shrink: 0;
		font-size: 11px;
		line-height: 1;
	}
	.chip-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.chip-x {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		width: 15px;
		height: 15px;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
		cursor: pointer;
	}
	.chip-x:hover {
		background: color-mix(in srgb, var(--color-foreground) 12%, transparent);
		color: var(--color-foreground);
	}

	.drop-hint {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 12px;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		pointer-events: none;
	}

	.chat-input[data-mode='ask'] {
		border-left-color: rgba(96, 165, 250, 0.5);
	}

	.chat-input[data-mode='capture'] {
		border-left-color: rgba(245, 158, 11, 0.6);
	}

	textarea {
		flex: 1;
		min-height: 21px;
		max-height: 96px;
		resize: none;
		background: transparent;
		border: none;
		color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
		font-size: 14px;
		line-height: 1.5;
		font-family: inherit;
		outline: none;
		padding: 0;
	}

	textarea::placeholder {
		color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
	}

	.kbd {
		font-size: 10px;
		color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
		padding: 2px 6px;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
		border-radius: 4px;
		font-family: ui-monospace, monospace;
	}

</style>
