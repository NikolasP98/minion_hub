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
	import { tick } from 'svelte';
	import {
		detectTrigger,
		applySuggestion,
		matches,
		type Suggestion,
	} from '$lib/chat/chat-suggest';
	import { visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
	import { agentSkillsState, loadAgentSkills } from '$lib/state/agents/agent-skills.svelte';
	import { getAliases, ensureAliases } from '$lib/state/features/aliases.svelte';
	import { channelPlugins, ensureChannelPlugins } from '$lib/state/features/channel-sources.svelte';
	import { conn } from '$lib/state/gateway';

	interface Props {
		onsubmit?: (text: string, mode: 'ask' | 'capture') => void;
		placeholder?: string;
		/** Bindable draft text — lets the parent inject a quote (Reply action). */
		value?: string;
		/** Personal agent id — scopes the `/` skill suggestions. */
		agentId?: string | null;
	}

	let {
		onsubmit,
		placeholder = m.chat_askYourAgent(),
		value = $bindable(''),
		agentId = null,
	}: Props = $props();
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
		closeMenu();
	}

	// ─── Smart-input popover (/ commands, @ mentions with dot notation) ──────────
	let caret = $state(0);
	let selIdx = $state(0);
	// Hydrate the suggestion sources once (skills need the agent id).
	$effect(() => {
		void ensureAliases();
		void ensureChannelPlugins();
	});
	$effect(() => {
		// Re-runs when the socket connects — an early load (pre-connect) would
		// cache an empty skill list and never retry.
		if (agentId && conn.connected) void loadAgentSkills(agentId);
	});

	function syncCaret() {
		caret = textarea?.selectionStart ?? value.length;
	}

	const trigger = $derived(detectTrigger(value, caret));

	const suggestions = $derived.by<Suggestion[]>(() => {
		const t = trigger;
		if (!t) return [];
		if (t.char === '/') {
			return agentSkillsState.skills
				.map((s) => ({
					value: s.skillKey,
					label: s.name || s.skillKey,
					detail: s.skillKey,
					icon: s.emoji || '🧩',
				}))
				.filter((s) => matches(`${s.value} ${s.label}`, t.query))
				.slice(0, 8);
		}
		if (t.char === '@') {
			const dot = t.query.indexOf('.');
			if (dot === -1) {
				const agents = visibleAgents.value.map((a) => ({
					value: a.name || a.id,
					label: a.name || a.id,
					detail: 'agent',
					icon: '🤖',
				}));
				const users = [...getAliases().keys()].map((al) => ({
					value: al,
					label: al,
					detail: 'user',
					icon: '👤',
				}));
				return [...agents, ...users].filter((s) => matches(s.value, t.query)).slice(0, 8);
			}
			// Dot notation: `@base.<channel>` — offer the base's channels.
			const base = t.query.slice(0, dot);
			const sub = t.query.slice(dot + 1);
			return channelPlugins()
				.filter((c) => matches(`${c.id} ${c.label}`, sub))
				.map((c) => ({
					value: `${base}.${c.id}`,
					label: `${base}.${c.id}`,
					detail: c.label,
					icon: '📡',
				}))
				.slice(0, 8);
		}
		return []; // `#` stays capture-mode; `!` is reserved — no picker.
	});

	const menuOpen = $derived(!!trigger && suggestions.length > 0);
	// Reset the highlight to the top row whenever the query changes (fresh filter).
	$effect(() => {
		void trigger?.query;
		void trigger?.char;
		selIdx = 0;
	});

	function closeMenu() {
		// Collapse by moving the caret past any trigger (detectTrigger re-evaluates).
		selIdx = 0;
	}

	async function choose(s: Suggestion) {
		const t = trigger;
		if (!t) return;
		const r = applySuggestion(value, t, s.value);
		value = r.text;
		await tick();
		if (textarea) {
			textarea.focus();
			textarea.setSelectionRange(r.caret, r.caret);
			caret = r.caret;
		}
	}

	// Popover-aware keys: arrows/enter/tab/escape drive the menu when it's open,
	// otherwise Enter sends. Mod+Enter always forces capture. Shift+Enter = newline.
	function onKeydown(e: KeyboardEvent) {
		if (menuOpen) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				selIdx = (selIdx + 1) % suggestions.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				selIdx = (selIdx - 1 + suggestions.length) % suggestions.length;
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				void choose(suggestions[selIdx]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				caret = -1; // force-close until the caret moves again
				return;
			}
		}
		if (e.key === 'Enter' && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			send(mode);
		}
	}

	// Mod+Enter (force capture) stays on the hotkeys attachment; plain Enter is
	// handled in onKeydown above so the popover can intercept it.
	const composeKeys = createHotkeysAttachment(
		[{ hotkey: 'Mod+Enter', callback: () => send('capture') }],
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
		{#if menuOpen}
			<div class="suggest" role="listbox" aria-label={m.chat_suggestions()}>
				{#each suggestions as s, i (s.value)}
					<button
						type="button"
						class="sg-item"
						class:active={i === selIdx}
						role="option"
						aria-selected={i === selIdx}
						onmousedown={(e) => {
							e.preventDefault();
							void choose(s);
						}}
						onmouseenter={() => (selIdx = i)}
					>
						<span class="sg-ic" aria-hidden="true">{s.icon ?? '•'}</span>
						<span class="sg-label">{s.label}</span>
						{#if s.detail}<span class="sg-detail">{s.detail}</span>{/if}
					</button>
				{/each}
			</div>
		{/if}
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
				onkeydown={onKeydown}
				onkeyup={syncCaret}
				onclick={syncCaret}
				oninput={() => {
					autoGrow();
					syncCaret();
				}}
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
		padding: 0;
		background: var(--color-bg);
	}

	/* Compact terminal input: tight box, uniform 1px outline (no accent left rail),
	   a mono prompt glyph does the framing. */
	.chat-input {
		position: relative;
		display: flex;
		flex-direction: column;
		/* Anchor the input row at the BOTTOM: attached chips stack above it and the
		   box grows upward, so the prompt + text never shift from their resting spot. */
		justify-content: flex-end;
		gap: 8px;
		padding: 8px 12px;
		min-height: 40px;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
		border-radius: 8px;
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

	/* Suggestion popover — docks just above the input box. */
	.suggest {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(100% + 6px);
		max-height: 240px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 4px;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);
		border-radius: 10px;
		background: var(--color-bg2);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
		z-index: 40;
		scrollbar-width: thin;
	}
	.sg-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: color-mix(in srgb, var(--color-foreground) 82%, transparent);
		cursor: pointer;
		text-align: left;
		width: 100%;
	}
	.sg-item.active {
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		color: var(--color-foreground);
	}
	.sg-ic {
		flex-shrink: 0;
		font-size: 13px;
		line-height: 1;
		width: 16px;
		text-align: center;
	}
	.sg-label {
		flex-shrink: 0;
		font-size: 13px;
	}
	.sg-detail {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: right;
		font-size: 11px;
		font-family: ui-monospace, monospace;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
	}

</style>
