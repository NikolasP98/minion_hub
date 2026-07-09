// AI ghost-text autocomplete for the Tiptap note editor.
//
// UX (note kind) — triggered via the hub hotkey layer (Alt+Space, see
// NoteEditor.svelte) which calls editor.commands.triggerAutofill():
//   - No pending suggestion → request a paragraph continuation from
//     /api/notes/autocomplete and show it as dimmed ghost text at the caret.
//   - Trigger again → accept: insert the suggestion as real text.
//   - Esc / typing / selection change → dismiss the ghost (nothing inserted).
//
// The suggestion lives in a ProseMirror plugin state as a single decoration
// widget. It's deliberately one-shot (not continuous as-you-type) to keep it
// subtle and cheap.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { fetchAutocomplete } from '$lib/state/features/notes-autocomplete';

export interface AutofillOptions {
  /** Note kind — the endpoint tailors the prompt. */
  kind: 'note';
  /** Returns the current text context to send to the model. */
  getContext: () => string;
}

interface AutofillState {
  /** The pending ghost suggestion, or null when nothing is shown. */
  text: string | null;
}

const key = new PluginKey<AutofillState>('autofill');

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		autofill: {
			/** Request an AI continuation, or accept the pending ghost suggestion. */
			triggerAutofill: () => ReturnType;
		};
	}
}

export function createAutofill(options: AutofillOptions): Extension {
  let inflight: AbortController | null = null;

  return Extension.create<AutofillOptions>({
    name: 'autofill',
    addOptions: () => options,

    addProseMirrorPlugins() {
      return [
        new Plugin<AutofillState>({
          key,
          state: {
            init: () => ({ text: null }),
            apply(tr, value) {
              const meta = tr.getMeta(key) as AutofillState | undefined;
              if (meta) return meta;
              // Any doc change or selection move clears a stale ghost.
              if (tr.docChanged || tr.selectionSet) return { text: null };
              return value;
            },
          },
          props: {
            decorations(state) {
              const s = key.getState(state);
              if (!s?.text) return null;
              // Recreate against the live doc for correct positioning.
              const pos = state.selection.head;
              const widget = Decoration.widget(
                pos,
                () => {
                  const span = document.createElement('span');
                  span.className = 'autofill-ghost';
                  span.textContent = s.text ?? '';
                  return span;
                },
                { side: 1 },
              );
              return DecorationSet.create(state.doc, [widget]);
            },
          },
        }),
      ];
    },

    addCommands() {
      const opts = this.options;
      return {
        triggerAutofill:
          () =>
          ({ editor, view }) => {
            const current = key.getState(view.state)?.text ?? null;

            // Second trigger → accept the pending suggestion.
            if (current) {
              inflight?.abort();
              inflight = null;
              editor.chain().focus().insertContent(current).run();
              view.dispatch(view.state.tr.setMeta(key, { text: null }));
              return true;
            }

            // First trigger → request a continuation (async; show when it lands).
            inflight?.abort();
            inflight = new AbortController();
            const signal = inflight.signal;
            void fetchAutocomplete({ kind: opts.kind, context: opts.getContext() }, signal)
              .then((res) => {
                if (signal.aborted) return;
                const text = 'suggestion' in res ? res.suggestion.trim() : '';
                if (text) view.dispatch(view.state.tr.setMeta(key, { text }));
              })
              .catch(() => {
                /* network/abort — silently no-op */
              });
            return true;
          },
      };
    },

    addKeyboardShortcuts() {
      return {
        Escape: () => {
          const view = this.editor.view;
          if (!key.getState(view.state)?.text) return false;
          view.dispatch(view.state.tr.setMeta(key, { text: null }));
          return true;
        },
      };
    },
  });
}
