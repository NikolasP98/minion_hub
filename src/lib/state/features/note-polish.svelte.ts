// Provisional AI "Polish" proposals for notes. A proposal holds suggested empty
// titles + a rewritten body per text block; it is held here (module-level) so it
// survives switching between the side-menu and zen views (same page) and is shown
// as a confirm/reject diff. It is NOT written to the note store until confirmed,
// and is discarded on a real navigation away (clearAllProposals).

import {
	setTextBlock,
	setBlockTitle,
	updateNote,
	type AgentNote
} from './agent-notes.svelte';
import { refineNote, type NotePolishIntent, type RefineBlockInput } from './notes-autocomplete';
import type { NoteBlock, TextBlock } from '$lib/types/notes';

export interface Change {
	id: string;
	from: string;
	to: string;
}
export interface PolishProposal {
	noteId: string;
	intent: NotePolishIntent;
	status: 'loading' | 'ready' | 'error';
	error?: string;
	/** Note title fill (only when the title was empty). */
	noteTitle?: { to: string };
	/** Titles for previously-empty todo/easel blocks. */
	blockTitles: Change[];
	/** Body rewrites for text blocks (from → to). */
	textBlocks: Change[];
}

export const polishState = $state<{ byNote: Record<string, PolishProposal | undefined> }>({
	byNote: {}
});

export function getProposal(noteId: string): PolishProposal | undefined {
	return polishState.byNote[noteId];
}

function set(p: PolishProposal) {
	polishState.byNote[p.noteId] = p;
}

export function clearProposal(noteId: string): void {
	// Direct property set (not whole-object reassign) so the per-note `$derived`
	// that reads `byNote[noteId]` reliably re-runs.
	polishState.byNote[noteId] = undefined;
}

export function clearAllProposals(): void {
	polishState.byNote = {};
}

/** A compact textual view of a block for the refine model. */
function blockContent(note: AgentNote, b: NoteBlock): string {
	if (b.type === 'text') return b.md;
	if (b.type === 'todo') {
		const done = b.items.filter((i) => i.done).length;
		return `Checklist (${done}/${b.items.length} done): ` + b.items.map((i) => i.text).filter(Boolean).join(', ');
	}
	const imgs = b.items.filter((i) => i.type === 'image').length;
	const txt = b.items.map((i) => (i.type === 'text' ? i.text : '')).join(' ');
	return `Easel board with ${imgs} image(s). ${txt}`.trim();
}

/** Run a polish pass for `note` with `intent`; stores a provisional proposal. */
export async function runPolish(note: AgentNote, intent: NotePolishIntent): Promise<void> {
	set({ noteId: note.id, intent, status: 'loading', blockTitles: [], textBlocks: [] });
	try {
		const blocks: RefineBlockInput[] = note.blocks.map((b) => ({
			id: b.id,
			type: b.type,
			title: b.type === 'text' ? undefined : b.title,
			content: blockContent(note, b)
		}));
		const res = await refineNote({ intent, title: note.title, blocks });

		const noteTitle = !note.title.trim() && res.title ? { to: res.title } : undefined;
		const blockTitles: Change[] = res.blocks
			.filter((bt) => {
				const b = note.blocks.find((x) => x.id === bt.id);
				return b && b.type !== 'text' && !(b.title ?? '').trim() && bt.title.trim();
			})
			.map((bt) => ({ id: bt.id, from: '', to: bt.title.trim() }));
		const textBlocks: Change[] = (res.textBlocks ?? [])
			.map((tb) => {
				const b = note.blocks.find((x): x is TextBlock => x.id === tb.id && x.type === 'text');
				if (!b || !tb.body.trim()) return null;
				if (tb.body.trim() === b.md.trim()) return null;
				return { id: tb.id, from: b.md, to: tb.body };
			})
			.filter((c): c is Change => c !== null);

		// Nothing to change → no proposal (avoid an empty diff view).
		if (!noteTitle && blockTitles.length === 0 && textBlocks.length === 0) {
			clearProposal(note.id);
			return;
		}
		set({ noteId: note.id, intent, status: 'ready', noteTitle, blockTitles, textBlocks });
	} catch {
		set({ noteId: note.id, intent, status: 'error', error: 'Could not polish this note.', blockTitles: [], textBlocks: [] });
	}
}

/** Apply a ready proposal to the note store, then clear it. */
export function applyProposal(noteId: string): string[] {
	const p = polishState.byNote[noteId];
	if (!p || p.status !== 'ready') return [];
	const filled: string[] = [];
	if (p.noteTitle) {
		updateNote(noteId, { title: p.noteTitle.to });
		filled.push('note');
	}
	for (const bt of p.blockTitles) {
		setBlockTitle(noteId, bt.id, bt.to);
		filled.push(bt.id);
	}
	for (const tb of p.textBlocks) {
		setTextBlock(noteId, tb.id, tb.to);
		filled.push(tb.id);
	}
	clearProposal(noteId);
	return filled;
}
