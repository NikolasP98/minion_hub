/**
 * Hub hotkey layer — the single import boundary for keyboard shortcuts.
 *
 * Every keyboard binding in the app imports from `$lib/hotkeys`, never from
 * `@tanstack/svelte-hotkeys` directly, so the underlying engine (currently
 * alpha) can be swapped later without touching call sites.
 *
 * Two modes:
 *   - global  → createHotkey('Mod+K', fn)              app-wide; gate a view with { enabled }
 *   - local   → createHotkeyAttachment('Mod+S', fn)    {@attach} to one element/view
 *
 * A third, `createHotkeySequence(['G', 'H'], fn)`, registers a Vim-style
 * multi-key chord (first key arms a ~1s/1.5s window for the next); used by
 * the `g`-then-key nav chords in `GNav.svelte`.
 *
 * `Mod` resolves to ⌘ on macOS and Ctrl elsewhere. Input-safety is automatic:
 * Ctrl/Meta combos and Escape fire even inside text inputs, bare keys don't —
 * override per-binding with { ignoreInputs }. Bindings clean up on component
 * unmount; must be called during component init (top of <script>), like $effect.
 *
 * `meta: { name, description }` on a binding feeds getHotkeyRegistrations(),
 * the source for the `?` shortcuts cheat-sheet (`ShortcutsOverlay.svelte`).
 */
import { createHotkeyAttachment } from '@tanstack/svelte-hotkeys';
import type { HotkeyCallback } from '@tanstack/svelte-hotkeys';

export {
	createHotkey,
	createHotkeys,
	createHotkeyAttachment,
	createHotkeysAttachment,
	createHotkeySequence,
	getHotkeyRegistrations,
	formatForDisplay,
} from '@tanstack/svelte-hotkeys';

export type {
	Hotkey,
	RawHotkey,
	RegisterableHotkey,
	HotkeyCallback,
	HotkeyRegistrationView,
	SequenceRegistrationView,
	CreateHotkeyOptions,
} from '@tanstack/svelte-hotkeys';

/**
 * `{@attach}` helper for chat/compose textareas: Enter submits, Shift+Enter
 * inserts a newline (native, untouched). Matches ONLY bare Enter — Shift/Ctrl/
 * Cmd/Alt+Enter fall through — and fires inside the focused input
 * (`ignoreInputs: false`). Replaces the hand-rolled
 * `onkeydown={e => e.key==='Enter' && !e.shiftKey && ...}` pattern.
 *
 * @example
 * ```svelte
 * <textarea {@attach submitOnEnter(() => send())}></textarea>
 * ```
 */
export function submitOnEnter(submit: HotkeyCallback) {
	return createHotkeyAttachment('Enter', submit, { ignoreInputs: false });
}

/**
 * `{@attach}` helper for compose boxes where bare Enter must stay a newline
 * (multi-line editors): Mod+Enter submits instead. Fires inside the focused
 * input (`ignoreInputs: false`).
 *
 * @example
 * ```svelte
 * <textarea {@attach submitOnModEnter(() => send())}></textarea>
 * ```
 */
export function submitOnModEnter(submit: HotkeyCallback) {
	return createHotkeyAttachment('Mod+Enter', submit, { ignoreInputs: false });
}
