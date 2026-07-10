/**
 * Smart-input trigger detection for the chat composer.
 *
 * A trigger token is a run of non-whitespace text that starts with one of the
 * trigger characters (`/ @ # !`), sitting at start-of-text or right after
 * whitespace, and ending at the caret. The popover in ChatInput turns the
 * detected token into a filtered suggestion list; selecting one replaces the
 * token in place (supporting dot notation like `@nikolas.whatsapp` or
 * `/notes.create`).
 */

export type TriggerChar = '/' | '@' | '#' | '!';
export const TRIGGERS: readonly TriggerChar[] = ['/', '@', '#', '!'] as const;

export interface ActiveTrigger {
	char: TriggerChar;
	/** Text between the trigger char and the caret (may contain a dot). */
	query: string;
	/** Index of the trigger char in the full text. */
	start: number;
	/** Caret index (end of the token). */
	end: number;
}

export interface Suggestion {
	/** Text inserted after the trigger char (e.g. `nikolas.whatsapp`). */
	value: string;
	label: string;
	detail?: string;
	icon?: string;
}

function isBoundary(ch: string | undefined): boolean {
	return ch === undefined || ch === ' ' || ch === '\n' || ch === '\t';
}

/** Detect the trigger token immediately preceding the caret, or null. */
export function detectTrigger(text: string, caret: number): ActiveTrigger | null {
	for (let i = caret - 1; i >= 0; i--) {
		const ch = text[i];
		if (isBoundary(ch)) return null; // hit whitespace before any trigger
		if ((TRIGGERS as readonly string[]).includes(ch)) {
			if (!isBoundary(text[i - 1])) return null; // mid-word `foo@bar` is not a trigger
			return { char: ch as TriggerChar, query: text.slice(i + 1, caret), start: i, end: caret };
		}
	}
	return null;
}

/** Replace the trigger token with the chosen value; returns new text + caret. */
export function applySuggestion(
	text: string,
	trigger: ActiveTrigger,
	value: string,
): { text: string; caret: number } {
	const before = text.slice(0, trigger.start);
	const after = text.slice(trigger.end);
	const insert = `${trigger.char}${value} `;
	const merged = before + insert + (after.startsWith(' ') ? after.slice(1) : after);
	return { text: merged, caret: (before + insert).length };
}

/** Case-insensitive substring filter used by every suggestion source. */
export function matches(haystack: string, query: string): boolean {
	return haystack.toLowerCase().includes(query.toLowerCase());
}
