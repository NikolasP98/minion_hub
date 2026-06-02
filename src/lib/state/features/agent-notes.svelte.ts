// Agent Notes & Todos — a Google Keep-style side panel for the My Agent page.
// Ported in spirit from the Odysseus notes/tasks modules, slimmed to a
// self-contained, client-persisted (localStorage) store. Notes hold freeform
// text; todos hold a checklist. Both support pin-to-top and a colour accent.
//
// Persistence is intentionally local-first (no gateway/DB round-trip) so the
// panel works offline and survives reloads; a future phase can sync these to a
// server table without changing the component contract.

const STORAGE_KEY = 'minion-agent-notes';

export type NoteColor = 'default' | 'amber' | 'rose' | 'sky' | 'violet' | 'green';

export interface TodoItem {
	id: string;
	text: string;
	done: boolean;
}

export interface AgentNote {
	id: string;
	kind: 'note' | 'todo';
	title: string;
	/** Freeform body — used by `kind: 'note'`. */
	body: string;
	/** Checklist — used by `kind: 'todo'`. */
	items: TodoItem[];
	color: NoteColor;
	pinned: boolean;
	createdAt: number;
	updatedAt: number;
}

/** Accent palette surfaced as colour dots in the card footer. */
export const NOTE_COLORS: { id: NoteColor; label: string; swatch: string }[] = [
	{ id: 'default', label: 'Default', swatch: 'rgba(255,255,255,0.14)' },
	{ id: 'amber', label: 'Amber', swatch: 'rgba(245,158,11,0.5)' },
	{ id: 'rose', label: 'Rose', swatch: 'rgba(232,125,106,0.55)' },
	{ id: 'sky', label: 'Sky', swatch: 'rgba(96,165,250,0.5)' },
	{ id: 'violet', label: 'Violet', swatch: 'rgba(167,139,250,0.5)' },
	{ id: 'green', label: 'Green', swatch: 'rgba(52,211,153,0.5)' }
];

/** Card background tint per colour (left-border + faint fill). */
export const COLOR_STYLES: Record<NoteColor, { border: string; fill: string }> = {
	default: { border: 'rgba(255,255,255,0.10)', fill: 'rgba(255,255,255,0.03)' },
	amber: { border: 'rgba(245,158,11,0.40)', fill: 'rgba(245,158,11,0.06)' },
	rose: { border: 'rgba(232,125,106,0.45)', fill: 'rgba(232,125,106,0.07)' },
	sky: { border: 'rgba(96,165,250,0.40)', fill: 'rgba(96,165,250,0.06)' },
	violet: { border: 'rgba(167,139,250,0.40)', fill: 'rgba(167,139,250,0.06)' },
	green: { border: 'rgba(52,211,153,0.40)', fill: 'rgba(52,211,153,0.06)' }
};

function uid(): string {
	try {
		return crypto.randomUUID();
	} catch {
		return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}
}

function now(): number {
	return Date.now();
}

export const notesState = $state({
	notes: [] as AgentNote[],
	/** Whether the side panel is open. Persisted separately. */
	open: false,
	query: '',
	loaded: false
});

const OPEN_KEY = 'minion-agent-notes-open';

export function loadNotes(): void {
	if (notesState.loaded) return;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as AgentNote[];
			if (Array.isArray(parsed)) notesState.notes = parsed.map(normalize);
		}
		notesState.open = localStorage.getItem(OPEN_KEY) === '1';
	} catch {
		/* ignore corrupt data */
	}
	notesState.loaded = true;
}

// Tolerate older/partial shapes from storage.
function normalize(n: Partial<AgentNote>): AgentNote {
	return {
		id: n.id ?? uid(),
		kind: n.kind === 'todo' ? 'todo' : 'note',
		title: n.title ?? '',
		body: n.body ?? '',
		items: Array.isArray(n.items)
			? n.items.map((it) => ({ id: it.id ?? uid(), text: it.text ?? '', done: !!it.done }))
			: [],
		color: (n.color as NoteColor) ?? 'default',
		pinned: !!n.pinned,
		createdAt: n.createdAt ?? now(),
		updatedAt: n.updatedAt ?? now()
	};
}

function persist(): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(notesState.notes));
	} catch {
		/* quota — drop silently */
	}
}

export function setPanelOpen(open: boolean): void {
	notesState.open = open;
	try {
		localStorage.setItem(OPEN_KEY, open ? '1' : '0');
	} catch {
		/* ignore */
	}
}

export function togglePanel(): void {
	setPanelOpen(!notesState.open);
}

// ─── Sorted view: pinned first, then most-recently-updated ───
export const sortedNotes = () => {
	const q = notesState.query.trim().toLowerCase();
	const filtered = q
		? notesState.notes.filter(
				(n) =>
					n.title.toLowerCase().includes(q) ||
					n.body.toLowerCase().includes(q) ||
					n.items.some((it) => it.text.toLowerCase().includes(q))
			)
		: notesState.notes;
	return [...filtered].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return b.updatedAt - a.updatedAt;
	});
};

// ─── CRUD ───

export function addNote(kind: 'note' | 'todo' = 'note'): AgentNote {
	const n: AgentNote = {
		id: uid(),
		kind,
		title: '',
		body: '',
		items: kind === 'todo' ? [{ id: uid(), text: '', done: false }] : [],
		color: 'default',
		pinned: false,
		createdAt: now(),
		updatedAt: now()
	};
	notesState.notes.unshift(n);
	persist();
	return n;
}

function find(id: string): AgentNote | undefined {
	return notesState.notes.find((n) => n.id === id);
}

function touch(n: AgentNote): void {
	n.updatedAt = now();
	persist();
}

export function updateNote(id: string, patch: Partial<Pick<AgentNote, 'title' | 'body'>>): void {
	const n = find(id);
	if (!n) return;
	if (patch.title !== undefined) n.title = patch.title;
	if (patch.body !== undefined) n.body = patch.body;
	touch(n);
}

export function deleteNote(id: string): void {
	const i = notesState.notes.findIndex((n) => n.id === id);
	if (i >= 0) {
		notesState.notes.splice(i, 1);
		persist();
	}
}

export function togglePin(id: string): void {
	const n = find(id);
	if (!n) return;
	n.pinned = !n.pinned;
	touch(n);
}

export function setColor(id: string, color: NoteColor): void {
	const n = find(id);
	if (!n) return;
	n.color = color;
	touch(n);
}

// ─── Todo items ───

export function addTodoItem(noteId: string, text = ''): TodoItem | undefined {
	const n = find(noteId);
	if (!n) return;
	const it: TodoItem = { id: uid(), text, done: false };
	n.items.push(it);
	touch(n);
	return it;
}

export function setTodoItemText(noteId: string, itemId: string, text: string): void {
	const n = find(noteId);
	const it = n?.items.find((i) => i.id === itemId);
	if (!n || !it) return;
	it.text = text;
	touch(n);
}

export function toggleTodoItem(noteId: string, itemId: string): void {
	const n = find(noteId);
	const it = n?.items.find((i) => i.id === itemId);
	if (!n || !it) return;
	it.done = !it.done;
	touch(n);
}

export function deleteTodoItem(noteId: string, itemId: string): void {
	const n = find(noteId);
	if (!n) return;
	const i = n.items.findIndex((it) => it.id === itemId);
	if (i >= 0) {
		n.items.splice(i, 1);
		touch(n);
	}
}

/** Completion summary for a todo card header, e.g. "2/5". */
export function todoProgress(n: AgentNote): { done: number; total: number } {
	const real = n.items.filter((it) => it.text.trim().length > 0);
	return { done: real.filter((it) => it.done).length, total: real.length };
}
