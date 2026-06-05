<script lang="ts">
	interface Props {
		onsubmit?: (text: string, mode: 'ask' | 'capture') => void;
		placeholder?: string;
	}

	const { onsubmit, placeholder = 'Ask your agent…' }: Props = $props();

	let value = $state('');
	let focused = $state(false);
	let textarea = $state<HTMLTextAreaElement | null>(null);

	// Mode is `capture` if the user holds modifier or prefixes with #.
	const mode = $derived<'ask' | 'capture'>(value.trimStart().startsWith('#') ? 'capture' : 'ask');

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			const captureModifier = e.metaKey || e.ctrlKey;
			const effectiveMode: 'ask' | 'capture' = captureModifier ? 'capture' : mode;
			e.preventDefault();
			const text = value.trim();
			if (!text) return;
			onsubmit?.(text, effectiveMode);
			value = '';
		}
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
	<div class="chat-input" class:focused data-mode={mode}>
		<textarea
			bind:this={textarea}
			bind:value
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			onkeydown={handleKeyDown}
			oninput={autoGrow}
			{placeholder}
			rows="1"
			aria-label="Chat with your agent"
		></textarea>
		<span class="kbd" aria-hidden="true">⌘K</span>
	</div>
	<p class="hint" aria-live="polite">
		{#if mode === 'capture'}
			Memory capture · ⌘↵ or # prefix
		{:else}
			Ask · ↵ to send
		{/if}
	</p>
</div>

<style>
	.chat-input-wrap {
		flex-shrink: 0;
		padding: 12px 0 16px;
		background: var(--color-bg);
	}

	.chat-input {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 12px 16px;
		min-height: 52px;
		background: var(--color-bg2);
		border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
		border-left-width: 3px;
		border-radius: 12px;
		transition: border-color 120ms ease, box-shadow 120ms ease;
	}

	.chat-input.focused {
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 25%, transparent);
	}

	.chat-input[data-mode='ask'] {
		border-left-color: rgba(96, 165, 250, 0.5);
	}

	.chat-input[data-mode='capture'] {
		border-left-color: rgba(245, 158, 11, 0.6);
	}

	textarea {
		flex: 1;
		min-height: 28px;
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
		margin-bottom: 2px;
	}

	.hint {
		font-size: 11px;
		color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
		margin: 6px 4px 0;
		text-align: right;
	}
</style>
