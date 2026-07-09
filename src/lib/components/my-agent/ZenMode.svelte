<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { updateNote, setNoteIcon, type AgentNote } from '$lib/state/features/agent-notes.svelte';
	import type { EaselBlock, TextBlock } from '$lib/types/notes';
	import NoteBlocks from './NoteBlocks.svelte';
	import TodoChecklist from './TodoChecklist.svelte';
	import NoteImageStrip from './NoteImageStrip.svelte';
	import ImageLightbox from './ImageLightbox.svelte';
	import EaselBoard from './EaselBoard.svelte';
	import TranscribeButton from './TranscribeButton.svelte';
	import NoteIconButton from './NoteIconButton.svelte';
	import PolishMenu from './PolishMenu.svelte';
	import { runPolish } from '$lib/state/features/note-polish.svelte';
	import { formatForDisplay } from '$lib/hotkeys';
	import { detectLang, countWords } from '$lib/utils/detect-lang';
	import {
		txPrefs,
		setNoteLang,
		setSpellcheck,
		NOTE_LANGS,
		type NoteLang
	} from '$lib/state/features/transcription-prefs.svelte';
	import { Check, Minimize2, Settings, Wand2 } from 'lucide-svelte';

	let { note, onclose }: { note: AgentNote | null; onclose: () => void } = $props();

	let lightboxSrc = $state<string | null>(null);
	let easelBlock = $state<{ note: AgentNote; block: EaselBlock } | null>(null);

	// The NoteBlocks instance — the header transcription controls feed its focused
	// text block (buffer/ghost live in that block's editor).
	type BlocksRef = {
		handleFinal: (t: string) => void;
		handleInterim: (t: string) => void;
		polishFocused: () => void;
		discardFocused: () => void;
		hasPendingFocused: () => boolean;
	};
	let blocksRef = $state<BlocksRef | undefined>();
	let polishMenuOpen = $state(false);
	let settingsOpen = $state(false);

	// Held-modifier tracking for the corner hotkey helpers (highlight on hold).
	let heldAlt = $state(false);
	let heldMod = $state(false);
	function trackMods(e: KeyboardEvent) {
		heldAlt = e.altKey;
		heldMod = e.ctrlKey || e.metaKey;
	}

	const LANG_LABELS: Record<NoteLang, () => string> = {
		auto: () => m.note_langAuto(),
		es: () => m.note_langEs(),
		en: () => m.note_langEn()
	};

	// Top-left meta: word count + detected language of the note body.
	const noteText = $derived(
		note && note.kind === 'note'
			? note.blocks?.length
				? note.blocks
						.filter((b): b is TextBlock => b.type === 'text')
						.map((b) => b.md)
						.join(' ')
				: (note.body ?? '')
			: ''
	);
	const wordCount = $derived(countWords(noteText));
	const detected = $derived(detectLang(noteText));

	// Bottom-left hotkey helpers; `group` is the modifier that lights the chip up.
	const HOTKEY_HINTS: { combo: string; label: () => string; group: 'alt' | 'mod' | null }[] = [
		{ combo: formatForDisplay('Alt+Space'), label: () => m.note_hkAiComplete(), group: 'alt' },
		{ combo: formatForDisplay('Mod+B'), label: () => m.note_formatBold(), group: 'mod' },
		{ combo: formatForDisplay('Mod+I'), label: () => m.note_formatItalic(), group: 'mod' },
		{ combo: '/', label: () => m.a11y1_insertBlock(), group: null },
		{ combo: formatForDisplay('Escape'), label: () => m.note_minimize(), group: null }
	];

	function onKey(e: KeyboardEvent) {
		trackMods(e);
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		// Esc closes open menus first, then minimizes.
		if (settingsOpen) settingsOpen = false;
		else if (polishMenuOpen) polishMenuOpen = false;
		else onclose();
	}
</script>

<svelte:window
	onkeydown={onKey}
	onkeyup={trackMods}
	onblur={() => {
		heldAlt = false;
		heldMod = false;
	}}
	onpointerdown={(e) => {
		if (polishMenuOpen && e.target instanceof Element && !e.target.closest('.zen-polish-wrap')) polishMenuOpen = false;
		if (settingsOpen && e.target instanceof Element && !e.target.closest('.zen-set-wrap')) settingsOpen = false;
	}}
/>

{#if note}
	{@const current = note}
	<div class="zen" role="dialog" aria-modal="true" aria-label={m.note_focusMode()}>
		<div class="zen-header">
			{#if current.kind === 'note'}
				<div class="zen-polish-wrap">
					<button
						type="button"
						class="zen-polish"
						class:on={polishMenuOpen}
						title={m.note_polishTitle()}
						aria-haspopup="menu"
						aria-expanded={polishMenuOpen}
						onclick={() => (polishMenuOpen = !polishMenuOpen)}
					>
						<Wand2 size={14} /> {m.note_polish()}
					</button>
					{#if polishMenuOpen}
						<div class="zen-polish-pop">
							<PolishMenu
								onpick={(intent) => void runPolish(current, intent)}
								onclose={() => (polishMenuOpen = false)}
							/>
						</div>
					{/if}
				</div>
				<TranscribeButton
					allowTab={true}
					detectedLang={() => detected}
					onfinal={(t) => blocksRef?.handleFinal(t)}
					oninterim={(t) => blocksRef?.handleInterim(t)}
					onpolish={() => blocksRef?.polishFocused()}
					ondiscard={() => blocksRef?.discardFocused()}
					hasPending={() => blocksRef?.hasPendingFocused() ?? false}
				/>
				<div class="zen-set-wrap">
					<button
						type="button"
						class="zen-min"
						class:on={settingsOpen}
						title={m.note_editorSettings()}
						aria-label={m.note_editorSettings()}
						aria-haspopup="menu"
						aria-expanded={settingsOpen}
						onclick={() => (settingsOpen = !settingsOpen)}
					>
						<Settings size={16} />
					</button>
					{#if settingsOpen}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="zen-set-menu" role="menu" tabindex="-1" onmousedown={(e) => e.preventDefault()}>
							<button
								type="button"
								role="menuitemcheckbox"
								aria-checked={txPrefs.spellcheck}
								class="zen-set-item"
								onclick={() => setSpellcheck(!txPrefs.spellcheck)}
							>
								<span class="zen-set-check" class:on={txPrefs.spellcheck}>
									{#if txPrefs.spellcheck}<Check size={11} />{/if}
								</span>
								{m.note_spellcheck()}
							</button>
							<div class="zen-set-sep"></div>
							<div class="zen-set-label">{m.note_language()}</div>
							{#each NOTE_LANGS as lang (lang)}
								<button
									type="button"
									role="menuitemradio"
									aria-checked={txPrefs.lang === lang}
									class="zen-set-item"
									onclick={() => setNoteLang(lang)}
								>
									<span class="zen-set-radio" class:on={txPrefs.lang === lang}></span>
									{LANG_LABELS[lang]()}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
			<button type="button" class="zen-min" title={m.note_minimizeTitle()} aria-label={m.note_minimize()} onclick={onclose}>
				<Minimize2 size={18} />
			</button>
		</div>

		<div class="zen-stage">
			<div class="zen-title-row">
				{#if current.kind === 'note'}
					<NoteIconButton icon={current.icon ?? ''} size={26} onpick={(v) => setNoteIcon(current.id, v)} />
				{/if}
				<input
					class="zen-title"
					placeholder={m.common_title?.()}
					value={current.title}
					oninput={(e) => updateNote(current.id, { title: e.currentTarget.value })}
					aria-label={m.common_title?.()}
				/>
			</div>

			<div class="zen-body" id={`note-${current.id}`}>
				{#if current.kind === 'todo'}
					<TodoChecklist note={current} large />
				{:else}
					<NoteBlocks
						bind:this={blocksRef}
						note={current}
						onopeneasel={(block) => (easelBlock = { note: current, block })}
					/>
				{/if}
			</div>

			<div class="zen-images">
				<NoteImageStrip note={current} onopen={(src) => (lightboxSrc = src)} />
			</div>
		</div>

		{#if current.kind === 'note'}
			<!-- Top-left meta: word count + detected language. -->
			<div class="zen-meta">
				<span>{m.note_words({ count: wordCount })}</span>
				{#if detected}
					<span class="zen-meta-sep">·</span>
					<span>{LANG_LABELS[detected]()}</span>
				{/if}
			</div>
			<!-- Subtle hotkey helpers; chips light up while their modifier is held. -->
			<div class="zen-hints" aria-hidden="true">
				{#each HOTKEY_HINTS as hint (hint.combo)}
					<span
						class="zen-hint"
						class:hot={(hint.group === 'alt' && heldAlt) || (hint.group === 'mod' && heldMod)}
					>
						<kbd>{hint.combo}</kbd>
						{hint.label()}
					</span>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<ImageLightbox src={lightboxSrc} onclose={() => (lightboxSrc = null)} />

{#if easelBlock}
	<EaselBoard note={easelBlock.note} block={easelBlock.block} onclose={() => (easelBlock = null)} />
{/if}

<style>
	.zen {
		position: fixed;
		inset: 0;
		z-index: 90;
		overflow-y: auto;
		background: radial-gradient(120% 100% at 50% 0%, var(--color-bg2), var(--color-bg));
		backdrop-filter: blur(10px);
		display: flex;
		justify-content: center;
	}
	.zen-stage {
		width: min(720px, 92vw);
		margin: 9vh 0 12vh;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.zen-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: -4px;
	}
	.zen-title {
		flex: 1;
		min-width: 0;
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-foreground);
		font-size: 28px;
		font-weight: 650;
		letter-spacing: -0.01em;
		font-family: inherit;
		padding: 0;
	}
	.zen-title::placeholder {
		color: color-mix(in srgb, var(--color-foreground) 22%, transparent);
	}
	.zen-body {
		font-size: 16px;
		line-height: 1.7;
	}
	/* Make the embedded editor breathe in focus mode. */
	.zen-body :global(.note-editor) {
		font-size: 16px;
		line-height: 1.7;
		color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
	}
	.zen-body :global(.note-editor .ProseMirror) {
		min-height: 40vh;
	}
	/* Keep the inline transcript ghost the same size as the focus-mode body. */
	.zen-body :global(.transcript-ghost) {
		font-size: 16px;
		line-height: 1.7;
	}
	.zen-images {
		margin-top: 6px;
		border-top: 1px solid var(--color-border);
		padding-top: 12px;
	}
	.zen-header {
		position: fixed;
		top: 16px;
		right: 18px;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	/* Note-polish trigger. */
	.zen-polish-wrap {
		position: relative;
		display: inline-flex;
	}
	.zen-polish-pop {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		z-index: 3;
	}
	.zen-polish {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 11px;
		font-size: 12px;
		font-family: inherit;
		border-radius: 8px;
		cursor: pointer;
		color: rgba(167, 139, 250, 0.9);
		background: rgba(167, 139, 250, 0.08);
		border: 1px solid rgba(167, 139, 250, 0.28);
		transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
	}
	.zen-polish:hover,
	.zen-polish.on {
		color: #fff;
		background: rgba(167, 139, 250, 0.22);
		border-color: rgba(167, 139, 250, 0.55);
	}
	/* Minimize button — borderless, subtle, icon highlights on hover. */
	.zen-min {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px;
		border-radius: 9px;
		cursor: pointer;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
		background: transparent;
		border: none;
		transition: color 120ms ease, background 120ms ease;
	}
	.zen-min:hover,
	.zen-min.on {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
	}
	/* Editor-settings popover (language). */
	.zen-set-wrap {
		position: relative;
		display: inline-flex;
	}
	.zen-set-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 3;
		min-width: 180px;
		display: flex;
		flex-direction: column;
		padding: 5px;
		border-radius: 10px;
		background: var(--color-bg2, #1b1b1f);
		border: 1px solid var(--color-border);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
	}
	.zen-set-label {
		padding: 6px 9px 3px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
	}
	.zen-set-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 9px;
		font-size: 12.5px;
		font-family: inherit;
		text-align: left;
		border-radius: 6px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: color-mix(in srgb, var(--color-foreground) 82%, transparent);
		transition: background 120ms ease, color 120ms ease;
	}
	.zen-set-item:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
	.zen-set-radio {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		border: 1.5px solid color-mix(in srgb, var(--color-foreground) 30%, transparent);
		flex-shrink: 0;
		position: relative;
	}
	.zen-set-radio.on {
		border-color: var(--color-accent);
	}
	.zen-set-radio.on::after {
		content: '';
		position: absolute;
		inset: 2.5px;
		border-radius: 50%;
		background: var(--color-accent);
	}
	.zen-set-sep {
		height: 1px;
		margin: 5px 4px;
		background: var(--color-border);
	}
	.zen-set-check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 15px;
		height: 15px;
		border-radius: 4px;
		border: 1.5px solid color-mix(in srgb, var(--color-foreground) 30%, transparent);
		flex-shrink: 0;
	}
	.zen-set-check.on {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}
	.zen-set-check :global(svg) {
		color: var(--color-accent-foreground, #fff);
	}
	/* Top-left meta (word count + detected language). */
	.zen-meta {
		position: fixed;
		top: 24px;
		left: 18px;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 10.5px;
		color: color-mix(in srgb, var(--color-foreground) 32%, transparent);
		pointer-events: none;
	}
	.zen-meta-sep {
		color: color-mix(in srgb, var(--color-foreground) 20%, transparent);
	}
	/* Bottom-left hotkey helpers. */
	.zen-hints {
		position: fixed;
		left: 18px;
		bottom: 16px;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 5px;
		pointer-events: none;
	}
	.zen-hint {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 10.5px;
		color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
		transition: color 120ms ease;
	}
	.zen-hint kbd {
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		padding: 1.5px 5px;
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 14%, transparent);
		background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
		color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
		transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
	}
	.zen-hint.hot {
		color: color-mix(in srgb, var(--color-foreground) 75%, transparent);
	}
	.zen-hint.hot kbd {
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
</style>
