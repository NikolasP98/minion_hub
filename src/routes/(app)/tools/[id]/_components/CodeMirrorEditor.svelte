<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { EditorState, Compartment, type Extension } from '@codemirror/state';
	import {
		EditorView,
		keymap,
		lineNumbers,
		highlightActiveLine,
		highlightActiveLineGutter,
		drawSelection,
		dropCursor,
		placeholder as placeholderExt,
	} from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { syntaxHighlighting, HighlightStyle, StreamLanguage } from '@codemirror/language';
	import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
	import { javascript } from '@codemirror/lang-javascript';
	import { python } from '@codemirror/lang-python';
	import { shell } from '@codemirror/legacy-modes/mode/shell';
	import { tags as t } from '@lezer/highlight';
	import { buildCompletionSource, type CompletionData } from './tool-editor-completions';
	import type { Lang } from './tool-editor-snippets';

	interface Props {
		value: string;
		lang: Lang;
		readonly?: boolean;
		placeholder?: string;
		completionData: CompletionData;
		onChange?: () => void;
	}

	let {
		value = $bindable(),
		lang,
		readonly = false,
		placeholder = '',
		completionData,
		onChange,
	}: Props = $props();

	let host: HTMLDivElement | undefined = $state(undefined);
	let view = $state<EditorView | undefined>(undefined);

	const langCompartment = new Compartment();
	const completionCompartment = new Compartment();
	const readonlyCompartment = new Compartment();
	const placeholderCompartment = new Compartment();

	function langExtension(l: Lang): Extension {
		if (l === 'javascript') return javascript();
		if (l === 'python') return python();
		return StreamLanguage.define(shell);
	}

	// Token colours from hub CSS custom properties so highlighting follows the
	// active light/dark theme (CM resolves the var() at paint time).
	const highlight = HighlightStyle.define([
		{ tag: [t.keyword, t.definitionKeyword, t.moduleKeyword, t.controlKeyword], color: 'var(--color-accent)' },
		{ tag: [t.string, t.special(t.string)], color: 'var(--color-success, #22c55e)' },
		{ tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--color-muted)', fontStyle: 'italic' },
		{ tag: [t.number, t.bool, t.null], color: 'var(--color-warning, #f59e0b)' },
		{ tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--color-accent)' },
		{ tag: [t.typeName, t.className, t.tagName], color: 'var(--color-accent)' },
		{ tag: [t.operator, t.punctuation, t.separator], color: 'var(--color-muted)' },
		{ tag: [t.variableName, t.propertyName, t.name], color: 'var(--color-foreground)' },
		{ tag: t.invalid, color: 'var(--color-error, #ef4444)' },
	]);

	const theme = EditorView.theme({
		'&': {
			height: '100%',
			color: 'var(--color-foreground)',
			backgroundColor: 'color-mix(in srgb, var(--color-bg) 85%, black)',
			fontSize: '0.8125rem',
		},
		'.cm-scroller': {
			fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", monospace',
			lineHeight: '1.7',
			overflow: 'auto',
		},
		'.cm-content': { caretColor: 'var(--color-accent)', padding: '1rem 0' },
		'.cm-gutters': { backgroundColor: 'transparent', color: 'var(--color-muted)', border: 'none' },
		'.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 6%, transparent)' },
		'.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-foreground)' },
		'&.cm-focused': { outline: 'none' },
		'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
		'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
			backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)',
		},
		'.cm-tooltip': {
			backgroundColor: 'var(--color-bg2)',
			border: '1px solid var(--color-border)',
			color: 'var(--color-foreground)',
			borderRadius: '0.375rem',
		},
		'.cm-tooltip-autocomplete ul li[aria-selected]': {
			backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
			color: 'var(--color-foreground)',
		},
		'.cm-completionLabel': { fontFamily: 'inherit' },
		'.cm-completionDetail': { color: 'var(--color-muted)', fontStyle: 'normal', marginLeft: '0.5rem' },
	});

	onMount(() => {
		if (!browser || !host) return;
		const state = EditorState.create({
			doc: value,
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				highlightActiveLineGutter(),
				history(),
				drawSelection(),
				dropCursor(),
				closeBrackets(),
				langCompartment.of(langExtension(lang)),
				completionCompartment.of(autocompletion({ override: [buildCompletionSource(completionData, lang)] })),
				readonlyCompartment.of([EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]),
				placeholderCompartment.of(placeholderExt(placeholder)),
				syntaxHighlighting(highlight),
				theme,
				keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
				EditorView.updateListener.of((u) => {
					if (u.docChanged) {
						value = u.state.doc.toString();
						onChange?.();
					}
				}),
			],
		});
		view = new EditorView({ state, parent: host });
	});

	onDestroy(() => view?.destroy());

	// External value changes (language switch reset, initial load) → sync doc.
	$effect(() => {
		const v = value;
		if (view && v !== view.state.doc.toString()) {
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
		}
	});

	// Reconfigure language + completions when either changes.
	$effect(() => {
		const l = lang;
		const cd = completionData;
		if (!view) return;
		view.dispatch({
			effects: [
				langCompartment.reconfigure(langExtension(l)),
				completionCompartment.reconfigure(autocompletion({ override: [buildCompletionSource(cd, l)] })),
			],
		});
	});

	$effect(() => {
		const ro = readonly;
		if (!view) return;
		view.dispatch({
			effects: readonlyCompartment.reconfigure([EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]),
		});
	});

	$effect(() => {
		const ph = placeholder;
		if (!view) return;
		view.dispatch({ effects: placeholderCompartment.reconfigure(placeholderExt(ph)) });
	});
</script>

<div class="cm-host" bind:this={host}></div>

<style>
	.cm-host {
		height: 100%;
		width: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.cm-host :global(.cm-editor) {
		height: 100%;
	}
</style>
