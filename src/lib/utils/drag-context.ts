/**
 * Drag-and-drop context payloads for the `/my-agent` page.
 *
 * Events, emails, notes, and todos can be dragged into the chat input to add
 * them as context for the agent. The drag source serialises a `DragContext`
 * onto the DataTransfer under a private MIME type; the ChatInput drop target
 * reads it back and renders a removable chip whose `text` is folded into the
 * prompt on send.
 *
 * We also write `text/plain` so a drop outside the app (or into a plain text
 * field) still yields something useful.
 */

export const DRAG_MIME = 'application/x-minion-context';

export type DragContextKind = 'event' | 'email' | 'note' | 'todo' | 'chat';

export interface DragContext {
	kind: DragContextKind;
	/** Short label for the chip (truncated in the UI). */
	label: string;
	/** Full context block folded into the prompt when the message is sent. */
	text: string;
}

const KIND_ICON: Record<DragContextKind, string> = {
	event: '📅',
	email: '✉️',
	note: '🗒️',
	todo: '☑️',
	chat: '💬',
};

export function dragContextIcon(kind: DragContextKind): string {
	return KIND_ICON[kind] ?? '📎';
}

/** Attach a context payload to a dragstart event. */
export function setDragContext(e: DragEvent, ctx: DragContext): void {
	if (!e.dataTransfer) return;
	e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ctx));
	e.dataTransfer.setData('text/plain', ctx.text);
	e.dataTransfer.effectAllowed = 'copy';
}

/** Read a context payload from a drop event, or null if it isn't one of ours. */
export function readDragContext(e: DragEvent): DragContext | null {
	const raw = e.dataTransfer?.getData(DRAG_MIME);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as DragContext;
		if (parsed && typeof parsed.text === 'string' && typeof parsed.label === 'string') {
			return parsed;
		}
	} catch {
		/* not our payload */
	}
	return null;
}

/** True when a drag event carries one of our context payloads. */
export function hasDragContext(e: DragEvent): boolean {
	return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DRAG_MIME);
}
