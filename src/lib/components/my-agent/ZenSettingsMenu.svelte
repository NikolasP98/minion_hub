<script lang="ts">
	// Zen editor-settings cog — Zag nested menu (root → Spelling / View).
	// Spelling: spellcheck toggle + language radio. View: toggle the zen
	// word-count meta (top-left) and hotkey hints (bottom-left).
	import * as menu from '@zag-js/menu';
	import { portal, normalizeProps, useMachine } from '@zag-js/svelte';
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { Check, ChevronRight, Settings } from 'lucide-svelte';
	import {
		txPrefs,
		setNoteLang,
		setSpellcheck,
		setShowMeta,
		setShowHints,
		NOTE_LANGS,
		type NoteLang
	} from '$lib/state/features/transcription-prefs.svelte';

	const id = $props.id();

	const LANG_LABELS: Record<NoteLang, () => string> = {
		auto: () => m.note_langAuto(),
		es: () => m.note_langEs(),
		en: () => m.note_langEn()
	};

	const rootService = useMachine(menu.machine as any, () => ({
		id: `${id}-root`,
		'aria-label': m.note_editorSettings(),
		positioning: { placement: 'bottom-end' as const }
	}));
	const root = $derived(menu.connect(rootService as any, normalizeProps));

	const spellService = useMachine(menu.machine as any, () => ({
		id: `${id}-spelling`,
		closeOnSelect: false,
		onSelect({ value }: { value: string }) {
			if (value === 'spellcheck') setSpellcheck(!txPrefs.spellcheck);
			else if (value.startsWith('lang:')) setNoteLang(value.slice(5) as NoteLang);
		}
	}));
	const spellMenu = $derived(menu.connect(spellService as any, normalizeProps));

	const viewService = useMachine(menu.machine as any, () => ({
		id: `${id}-view`,
		closeOnSelect: false,
		onSelect({ value }: { value: string }) {
			if (value === 'meta') setShowMeta(!txPrefs.showMeta);
			else if (value === 'hints') setShowHints(!txPrefs.showHints);
		}
	}));
	const viewMenu = $derived(menu.connect(viewService as any, normalizeProps));

	onMount(() => {
		root.setChild(spellService as any);
		spellMenu.setParent(rootService as any);
		root.setChild(viewService as any);
		viewMenu.setParent(rootService as any);
	});
</script>

<button
	{...root.getTriggerProps()}
	class="zs-trigger"
	class:on={root.open}
	title={m.note_editorSettings()}
	aria-label={m.note_editorSettings()}
>
	<Settings size={16} />
</button>

<div use:portal {...root.getPositionerProps()} style:z-index="96">
	<div {...root.getContentProps()} class="zs-menu">
		<button {...root.getTriggerItemProps(spellMenu)} class="zs-item">
			{m.note_spelling()}
			<ChevronRight size={13} class="zs-chev" />
		</button>
		<button {...root.getTriggerItemProps(viewMenu)} class="zs-item">
			{m.note_view()}
			<ChevronRight size={13} class="zs-chev" />
		</button>
	</div>
</div>

<div use:portal {...spellMenu.getPositionerProps()} style:z-index="97">
	<div {...spellMenu.getContentProps()} class="zs-menu">
		<button {...spellMenu.getItemProps({ value: 'spellcheck' })} class="zs-item">
			<span class="zs-check" class:on={txPrefs.spellcheck}>
				{#if txPrefs.spellcheck}<Check size={11} />{/if}
			</span>
			{m.note_spellcheck()}
		</button>
		<div class="zs-sep"></div>
		<div class="zs-label">{m.note_language()}</div>
		{#each NOTE_LANGS as lang (lang)}
			<button {...spellMenu.getItemProps({ value: `lang:${lang}` })} class="zs-item">
				<span class="zs-radio" class:on={txPrefs.lang === lang}></span>
				{LANG_LABELS[lang]()}
			</button>
		{/each}
	</div>
</div>

<div use:portal {...viewMenu.getPositionerProps()} style:z-index="97">
	<div {...viewMenu.getContentProps()} class="zs-menu">
		<button {...viewMenu.getItemProps({ value: 'meta' })} class="zs-item">
			<span class="zs-check" class:on={txPrefs.showMeta}>
				{#if txPrefs.showMeta}<Check size={11} />{/if}
			</span>
			{m.note_showMeta()}
		</button>
		<button {...viewMenu.getItemProps({ value: 'hints' })} class="zs-item">
			<span class="zs-check" class:on={txPrefs.showHints}>
				{#if txPrefs.showHints}<Check size={11} />{/if}
			</span>
			{m.note_showHints()}
		</button>
	</div>
</div>

<style>
	.zs-trigger {
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
	.zs-trigger:hover,
	.zs-trigger.on {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
	}
	.zs-menu {
		min-width: 190px;
		display: flex;
		flex-direction: column;
		padding: 5px;
		border-radius: 10px;
		background: var(--color-bg2, #1b1b1f);
		border: 1px solid var(--color-border);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
		outline: none;
	}
	.zs-item {
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
	.zs-item:hover,
	.zs-item[data-highlighted] {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
	.zs-item :global(.zs-chev) {
		margin-left: auto;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
	}
	.zs-label {
		padding: 6px 9px 3px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
	}
	.zs-sep {
		height: 1px;
		margin: 5px 4px;
		background: var(--color-border);
	}
	.zs-check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 15px;
		height: 15px;
		border-radius: 4px;
		border: 1.5px solid color-mix(in srgb, var(--color-foreground) 30%, transparent);
		flex-shrink: 0;
	}
	.zs-check.on {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}
	.zs-check :global(svg) {
		color: var(--color-accent-foreground, #fff);
	}
	.zs-radio {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		border: 1.5px solid color-mix(in srgb, var(--color-foreground) 30%, transparent);
		flex-shrink: 0;
		position: relative;
	}
	.zs-radio.on {
		border-color: var(--color-accent);
	}
	.zs-radio.on::after {
		content: '';
		position: absolute;
		inset: 2.5px;
		border-radius: 50%;
		background: var(--color-accent);
	}
</style>
