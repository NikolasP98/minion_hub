// Agent Notes & Todos — a Google-Keep-style side panel for the My Agent page,
// now SERVER-BACKED (Supabase via /api/notes) instead of localStorage. Notes
// hold Markdown text, todos hold a checklist, and `easel` notes hold a freeform
// PureRef-style board. All three support image attachments, a colour accent and
// pin-to-top.
//
// Persistence model: local-first optimism + debounced autosave. Mutations update
// the in-memory store immediately; a 600 ms debounce flushes a PUT. Creates POST
// right away and reconcile the server id behind a stable client id (so the keyed
// list never re-mounts). One-time migration imports any legacy localStorage
// notes on first load.

import {
  defaultNoteData,
  type Attachment,
  type EaselData,
  type EaselItem,
  type NoteColor,
  type NoteData,
  type NoteDocument,
  type NoteKind,
  type TodoData,
  type TodoItem,
} from '$lib/types/notes';

export type { NoteColor, TodoItem, Attachment, EaselItem };
export type NoteKindClient = NoteKind;

/** Client-side note: a flat, panel-friendly shape mapped to/from the server `data` doc. */
export interface AgentNote {
  /** Stable client id; equals the server id once a created note is reconciled. */
  id: string;
  kind: NoteKind;
  title: string;
  /** Markdown body — `kind: 'note'`. */
  body: string;
  /** Checklist — `kind: 'todo'`. */
  items: TodoItem[];
  /** Images bound to a note/todo card. */
  attachments: Attachment[];
  /** Freeform board — `kind: 'easel'`. */
  easel: EaselData;
  color: NoteColor;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Server note shape returned by /api/notes. */
interface ServerNote {
  id: string;
  kind: NoteKind;
  title: string;
  color: NoteColor;
  pinned: boolean;
  data: NoteDocument;
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
  { id: 'green', label: 'Green', swatch: 'rgba(52,211,153,0.5)' },
];

/** Card background tint per colour (left-border + faint fill). */
export const COLOR_STYLES: Record<NoteColor, { border: string; fill: string }> = {
  default: { border: 'rgba(255,255,255,0.10)', fill: 'rgba(255,255,255,0.03)' },
  amber: { border: 'rgba(245,158,11,0.40)', fill: 'rgba(245,158,11,0.06)' },
  rose: { border: 'rgba(232,125,106,0.45)', fill: 'rgba(232,125,106,0.07)' },
  sky: { border: 'rgba(96,165,250,0.40)', fill: 'rgba(96,165,250,0.06)' },
  violet: { border: 'rgba(167,139,250,0.40)', fill: 'rgba(167,139,250,0.06)' },
  green: { border: 'rgba(52,211,153,0.40)', fill: 'rgba(52,211,153,0.06)' },
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
  loaded: false,
  loading: false,
  /** Number of in-flight saves — surfaced as a subtle "saving…" hint. */
  saving: 0,
});

const OPEN_KEY = 'minion-agent-notes-open';
const LEGACY_KEY = 'minion-agent-notes';
const MIGRATED_KEY = 'minion-agent-notes-migrated';

// ─── Server ⇄ client mapping ───

function toClient(s: ServerNote): AgentNote {
  const base: AgentNote = {
    id: s.id,
    kind: s.kind,
    title: s.title,
    color: s.color,
    pinned: s.pinned,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    body: '',
    items: [],
    attachments: [],
    easel: { items: [] },
  };
  if (s.kind === 'todo') {
    const d = s.data as TodoData;
    base.items = d.items ?? [];
    base.attachments = d.attachments ?? [];
  } else if (s.kind === 'easel') {
    base.easel = (s.data as EaselData) ?? { items: [] };
  } else {
    const d = s.data as NoteData;
    base.body = d.body ?? '';
    base.attachments = d.attachments ?? [];
  }
  return base;
}

function toServerData(n: AgentNote): NoteDocument {
  if (n.kind === 'todo') return { items: n.items, attachments: n.attachments };
  if (n.kind === 'easel') return n.easel;
  return { body: n.body, attachments: n.attachments };
}

// ─── Save coordinator ───
//
// Notes are created optimistically with a client id; the server id arrives
// async. Saves/deletes target the server id, so we hold a client→server map and
// queue work that lands before the create resolves.

const serverIdOf: Record<string, string> = {};
const saveTimer: Record<string, ReturnType<typeof setTimeout>> = {};
const dirtyDuringCreate = new Set<string>();
const deleteAfterCreate = new Set<string>();
const creating = new Set<string>();

function scheduleSave(clientId: string): void {
  if (creating.has(clientId)) {
    dirtyDuringCreate.add(clientId);
    return;
  }
  clearTimeout(saveTimer[clientId]);
  saveTimer[clientId] = setTimeout(() => void flushSave(clientId), 600);
}

async function flushSave(clientId: string): Promise<void> {
  const serverId = serverIdOf[clientId];
  const note = notesState.notes.find((n) => n.id === clientId);
  if (!serverId || !note) return;
  notesState.saving++;
  try {
    await fetch(`/api/notes/${serverId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: note.title,
        color: note.color,
        pinned: note.pinned,
        data: toServerData(note),
      }),
    });
  } catch {
    /* keep local state; next edit retries */
  } finally {
    notesState.saving--;
  }
}

async function createRemote(note: AgentNote): Promise<void> {
  creating.add(note.id);
  notesState.saving++;
  try {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: note.kind,
        title: note.title,
        color: note.color,
        data: toServerData(note),
      }),
    });
    if (res.ok) {
      const { note: created } = (await res.json()) as { note: ServerNote };
      serverIdOf[note.id] = created.id;
    }
  } catch {
    /* offline — note stays local-only; a later reload may drop it */
  } finally {
    creating.delete(note.id);
    notesState.saving--;
    if (deleteAfterCreate.has(note.id)) {
      deleteAfterCreate.delete(note.id);
      void deleteRemote(note.id);
    } else if (dirtyDuringCreate.has(note.id)) {
      dirtyDuringCreate.delete(note.id);
      scheduleSave(note.id);
    }
  }
}

async function deleteRemote(clientId: string): Promise<void> {
  const serverId = serverIdOf[clientId];
  if (!serverId) return;
  delete serverIdOf[clientId];
  try {
    await fetch(`/api/notes/${serverId}`, { method: 'DELETE' });
  } catch {
    /* best-effort */
  }
}

// ─── Load + migrate ───

export async function loadNotes(): Promise<void> {
  if (notesState.loaded || notesState.loading) return;
  notesState.loading = true;
  try {
    try {
      notesState.open = localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      /* ignore */
    }
    const res = await fetch('/api/notes');
    if (res.ok) {
      const { notes } = (await res.json()) as { notes: ServerNote[] };
      notesState.notes = notes.map((s) => {
        serverIdOf[s.id] = s.id;
        return toClient(s);
      });
    }
    await migrateLegacy();
  } catch {
    /* leave empty; panel still works */
  } finally {
    notesState.loaded = true;
    notesState.loading = false;
  }
}

/** Import legacy localStorage notes once, then clear them. */
async function migrateLegacy(): Promise<void> {
  let raw: string | null = null;
  try {
    if (localStorage.getItem(MIGRATED_KEY) === '1') return;
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    return;
  }
  if (raw) {
    try {
      const legacy = JSON.parse(raw) as Partial<AgentNote>[];
      if (Array.isArray(legacy)) {
        for (const l of legacy) {
          const kind: NoteKind = l.kind === 'todo' ? 'todo' : 'note';
          const note = blankNote(kind);
          note.title = l.title ?? '';
          note.body = l.body ?? '';
          note.items = Array.isArray(l.items)
            ? l.items.map((it) => ({ id: it.id ?? uid(), text: it.text ?? '', done: !!it.done }))
            : [];
          note.color = (l.color as NoteColor) ?? 'default';
          note.pinned = !!l.pinned;
          notesState.notes.unshift(note);
          await createRemote(note);
        }
      }
    } catch {
      /* ignore corrupt legacy data */
    }
  }
  try {
    localStorage.setItem(MIGRATED_KEY, '1');
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Panel open state ───

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
          n.items.some((it) => it.text.toLowerCase().includes(q)),
      )
    : notesState.notes;
  return [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
};

// ─── CRUD ───

function blankNote(kind: NoteKind): AgentNote {
  const d = defaultNoteData(kind);
  return {
    id: uid(),
    kind,
    title: '',
    body: kind === 'note' ? (d as NoteData).body : '',
    items: kind === 'todo' ? (d as TodoData).items : [],
    attachments: kind === 'easel' ? [] : ((d as NoteData | TodoData).attachments ?? []),
    easel: kind === 'easel' ? (d as EaselData) : { items: [] },
    color: 'default',
    pinned: false,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function addNote(kind: NoteKind = 'note'): AgentNote {
  const n = blankNote(kind);
  if (kind === 'todo') n.items = [{ id: uid(), text: '', done: false }];
  notesState.notes.unshift(n);
  void createRemote(n);
  return n;
}

function find(id: string): AgentNote | undefined {
  return notesState.notes.find((n) => n.id === id);
}

function touch(n: AgentNote): void {
  n.updatedAt = now();
  scheduleSave(n.id);
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
  if (i < 0) return;
  notesState.notes.splice(i, 1);
  clearTimeout(saveTimer[id]);
  if (creating.has(id)) deleteAfterCreate.add(id);
  else void deleteRemote(id);
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

// ─── Image attachments ───

/** Upload a local image file to B2 (category 'notes'); returns the fileId. */
export async function uploadNoteImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('category', 'notes');
  const res = await fetch('/api/files', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('upload failed');
  const { id } = (await res.json()) as { id: string };
  return id;
}

/** Re-host a remote image URL via the SSRF-guarded endpoint; returns the fileId. */
export async function fetchImageFromUrl(url: string): Promise<string> {
  const res = await fetch('/api/notes/fetch-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || 'Could not fetch that image.');
  }
  const { fileId } = (await res.json()) as { fileId: string };
  return fileId;
}

export function addAttachment(noteId: string, fileId: string, w = 0, h = 0): void {
  const n = find(noteId);
  if (!n) return;
  n.attachments.push({ id: uid(), fileId, w, h });
  touch(n);
}

export function setAttachmentSize(noteId: string, attachmentId: string, w: number, h: number): void {
  const n = find(noteId);
  const a = n?.attachments.find((x) => x.id === attachmentId);
  if (!n || !a) return;
  a.w = w;
  a.h = h;
  scheduleSave(n.id);
}

export function removeAttachment(noteId: string, attachmentId: string): void {
  const n = find(noteId);
  if (!n) return;
  const i = n.attachments.findIndex((a) => a.id === attachmentId);
  if (i >= 0) {
    n.attachments.splice(i, 1);
    touch(n);
  }
}

// ─── Easel items ───

export function addEaselItem(noteId: string, item: EaselItem): void {
  const n = find(noteId);
  if (!n) return;
  n.easel.items.push(item);
  touch(n);
}

export function updateEaselItem(noteId: string, itemId: string, patch: Partial<EaselItem>): void {
  const n = find(noteId);
  const it = n?.easel.items.find((i) => i.id === itemId);
  if (!n || !it) return;
  Object.assign(it, patch);
  touch(n);
}

export function deleteEaselItem(noteId: string, itemId: string): void {
  const n = find(noteId);
  if (!n) return;
  const i = n.easel.items.findIndex((it) => it.id === itemId);
  if (i >= 0) {
    n.easel.items.splice(i, 1);
    touch(n);
  }
}

export function setEaselCamera(noteId: string, camera: { x: number; y: number; zoom: number }): void {
  const n = find(noteId);
  if (!n) return;
  n.easel.camera = camera;
  scheduleSave(n.id);
}

/** Highest z among easel items (for placing a new item on top). */
export function topEaselZ(n: AgentNote): number {
  return n.easel.items.reduce((m, it) => Math.max(m, it.z), 0);
}
