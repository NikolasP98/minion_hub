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
  type NoteBlock,
  type NoteColor,
  type NoteData,
  type NoteDocument,
  type NoteKind,
  type TextBlock,
  type EaselBlock,
  type TodoData,
  type TodoItem,
} from '$lib/types/notes';

import { toastError } from '$lib/state/ui/toast.svelte';

export type { NoteColor, TodoItem, Attachment, EaselItem, NoteBlock };
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
  /** Unified block document — `kind: 'note'`. Text/todo/easel embedded in order. */
  blocks: NoteBlock[];
  /** Emoji char or `lucide:<Name>` — shown left of the title. */
  icon?: string;
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
  /** Id of the single inline-expanded card; all others render clamped. Ephemeral. */
  expandedId: null as string | null,
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
    blocks: [],
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
    base.icon = d.icon;
    // Unified blocks are the source of truth when present; otherwise shim the
    // legacy single-text note into one text block so it renders in the block UI.
    base.blocks =
      d.blocks && d.blocks.length > 0
        ? d.blocks
        : [{ id: uid(), type: 'text', md: d.body ?? '', attachments: d.attachments ?? [] }];
  }
  return base;
}

function toServerData(n: AgentNote): NoteDocument {
  if (n.kind === 'todo') return { items: n.items, attachments: n.attachments };
  if (n.kind === 'easel') return n.easel;
  // Mirror the first text block into legacy `body`/`attachments` so search and any
  // older reader still work, and persist the full block document.
  const firstText = n.blocks.find((b): b is TextBlock => b.type === 'text');
  return {
    body: firstText?.md ?? '',
    attachments: firstText?.attachments ?? [],
    blocks: n.blocks,
    icon: n.icon,
  };
}

/** Set (or clear, with '') the note's icon — an emoji char or `lucide:<Name>`. */
export function setNoteIcon(id: string, icon: string): void {
  const n = find(id);
  if (!n) return;
  n.icon = icon || undefined;
  touch(n);
}

// ─── Save coordinator ───
//
// Notes are created optimistically with a client id; the server id arrives
// async. Saves/deletes target the server id, so we hold a client→server map and
// queue work that lands before the create resolves.

const serverIdOf: Record<string, string> = {};
// deferred: keyed save debounce stays hand-rolled (pacer createKeyedDebouncer candidate)
const saveTimer: Record<string, ReturnType<typeof setTimeout>> = {};
/** clientIds that have already had one automatic save retry — bounds the retry to 1 attempt. */
const saveRetried = new Set<string>();
const dirtyDuringCreate = new Set<string>();
const deleteAfterCreate = new Set<string>();
const creating = new Set<string>();

function scheduleSave(clientId: string): void {
  if (creating.has(clientId)) {
    dirtyDuringCreate.add(clientId);
    return;
  }
  saveRetried.delete(clientId); // fresh edit resets the retry budget
  clearTimeout(saveTimer[clientId]);
  saveTimer[clientId] = setTimeout(() => void flushSave(clientId), 600);
}

async function flushSave(clientId: string): Promise<void> {
  const serverId = serverIdOf[clientId];
  const note = notesState.notes.find((n) => n.id === clientId);
  if (!serverId || !note) return;
  notesState.saving++;
  try {
    const res = await fetch(`/api/notes/${serverId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: note.title,
        color: note.color,
        pinned: note.pinned,
        data: toServerData(note),
      }),
    });
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    saveRetried.delete(clientId);
  } catch {
    // One bounded auto-retry (the debounce alone silently drifted before this fix);
    // if that also fails, surface it — local state is kept either way.
    if (saveRetried.has(clientId)) {
      saveRetried.delete(clientId);
      toastError('Note failed to save', 'Your edits are kept locally — edit the note again to retry.');
    } else {
      saveRetried.add(clientId);
      saveTimer[clientId] = setTimeout(() => void flushSave(clientId), 3000);
    }
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
      void deleteRemote(note.id, note);
    } else if (dirtyDuringCreate.has(note.id)) {
      dirtyDuringCreate.delete(note.id);
      scheduleSave(note.id);
    }
  }
}

async function deleteRemote(clientId: string, note: AgentNote): Promise<void> {
  const serverId = serverIdOf[clientId];
  if (!serverId) return;
  delete serverIdOf[clientId];
  try {
    const res = await fetch(`/api/notes/${serverId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`delete failed (${res.status})`);
  } catch {
    // Delete didn't land server-side — restore the note instead of silently dropping it.
    serverIdOf[clientId] = serverId;
    notesState.notes.push(note);
    toastError('Failed to delete note', 'The note has been restored.');
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
    blocks: kind === 'note' ? [{ id: uid(), type: 'text', md: '', attachments: [] }] : [],
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

// ─── Note blocks (kind: 'note') ───

function findBlock(noteId: string, blockId: string): { note: AgentNote; index: number } | undefined {
  const note = find(noteId);
  if (!note) return;
  const index = note.blocks.findIndex((b) => b.id === blockId);
  if (index < 0) return;
  return { note, index };
}

/** Insert a new block after `afterBlockId` (or at the end). Returns the new block. */
export function addBlock(
  noteId: string,
  type: NoteBlock['type'],
  afterBlockId?: string,
): NoteBlock | undefined {
  const note = find(noteId);
  if (!note) return;
  let block: NoteBlock;
  if (type === 'todo') block = { id: uid(), type: 'todo', items: [{ id: uid(), text: '', done: false }] };
  else if (type === 'easel') block = { id: uid(), type: 'easel', items: [] };
  else block = { id: uid(), type: 'text', md: '', attachments: [] };

  const at = afterBlockId ? note.blocks.findIndex((b) => b.id === afterBlockId) : -1;
  if (at >= 0) note.blocks.splice(at + 1, 0, block);
  else note.blocks.push(block);
  touch(note);
  return block;
}

export function removeBlock(noteId: string, blockId: string): void {
  const hit = findBlock(noteId, blockId);
  if (!hit) return;
  hit.note.blocks.splice(hit.index, 1);
  // Never leave a note with zero blocks — keep one empty text block.
  if (hit.note.blocks.length === 0)
    hit.note.blocks.push({ id: uid(), type: 'text', md: '', attachments: [] });
  touch(hit.note);
}

export function moveBlock(noteId: string, blockId: string, dir: -1 | 1): void {
  const hit = findBlock(noteId, blockId);
  if (!hit) return;
  const to = hit.index + dir;
  if (to < 0 || to >= hit.note.blocks.length) return;
  const [b] = hit.note.blocks.splice(hit.index, 1);
  hit.note.blocks.splice(to, 0, b);
  touch(hit.note);
}

export function setTextBlock(noteId: string, blockId: string, md: string): void {
  const hit = findBlock(noteId, blockId);
  if (!hit) return;
  const b = hit.note.blocks[hit.index];
  if (b.type !== 'text') return;
  b.md = md;
  touch(hit.note);
}

/** Set the title of a todo/easel block (text blocks have no title). */
export function setBlockTitle(noteId: string, blockId: string, title: string): void {
  const hit = findBlock(noteId, blockId);
  if (!hit) return;
  const b = hit.note.blocks[hit.index];
  if (b.type === 'text') return;
  b.title = title;
  touch(hit.note);
}

function blockOfType<T extends NoteBlock['type']>(
  noteId: string,
  blockId: string,
  type: T,
): Extract<NoteBlock, { type: T }> | undefined {
  const hit = findBlock(noteId, blockId);
  if (!hit) return;
  const b = hit.note.blocks[hit.index];
  if (b.type !== type) return;
  return b as Extract<NoteBlock, { type: T }>;
}

// Todo block items
export function addBlockTodoItem(noteId: string, blockId: string, text = ''): TodoItem | undefined {
  const b = blockOfType(noteId, blockId, 'todo');
  const n = find(noteId);
  if (!b || !n) return;
  const it: TodoItem = { id: uid(), text, done: false };
  b.items.push(it);
  touch(n);
  return it;
}
export function setBlockTodoItemText(noteId: string, blockId: string, itemId: string, text: string): void {
  const b = blockOfType(noteId, blockId, 'todo');
  const n = find(noteId);
  const it = b?.items.find((i) => i.id === itemId);
  if (!b || !n || !it) return;
  it.text = text;
  touch(n);
}
export function toggleBlockTodoItem(noteId: string, blockId: string, itemId: string): void {
  const b = blockOfType(noteId, blockId, 'todo');
  const n = find(noteId);
  const it = b?.items.find((i) => i.id === itemId);
  if (!b || !n || !it) return;
  it.done = !it.done;
  touch(n);
}
export function deleteBlockTodoItem(noteId: string, blockId: string, itemId: string): void {
  const b = blockOfType(noteId, blockId, 'todo');
  const n = find(noteId);
  if (!b || !n) return;
  const i = b.items.findIndex((it) => it.id === itemId);
  if (i >= 0) {
    b.items.splice(i, 1);
    touch(n);
  }
}

// Easel block items
export function addBlockEaselItem(noteId: string, blockId: string, item: EaselItem): void {
  const b = blockOfType(noteId, blockId, 'easel');
  const n = find(noteId);
  if (!b || !n) return;
  b.items.push(item);
  touch(n);
}
export function updateBlockEaselItem(noteId: string, blockId: string, itemId: string, patch: Partial<EaselItem>): void {
  const b = blockOfType(noteId, blockId, 'easel');
  const n = find(noteId);
  const it = b?.items.find((i) => i.id === itemId);
  if (!b || !n || !it) return;
  Object.assign(it, patch);
  touch(n);
}
export function deleteBlockEaselItem(noteId: string, blockId: string, itemId: string): void {
  const b = blockOfType(noteId, blockId, 'easel');
  const n = find(noteId);
  if (!b || !n) return;
  const i = b.items.findIndex((it) => it.id === itemId);
  if (i >= 0) {
    b.items.splice(i, 1);
    touch(n);
  }
}
export function setBlockEaselCamera(noteId: string, blockId: string, camera: { x: number; y: number; zoom: number }): void {
  const b = blockOfType(noteId, blockId, 'easel');
  const n = find(noteId);
  if (!b || !n) return;
  b.camera = camera;
  scheduleSave(n.id);
}
export function topBlockEaselZ(b: EaselBlock): number {
  return b.items.reduce((m, it) => Math.max(m, it.z), 0);
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
  const [note] = notesState.notes.splice(i, 1);
  clearTimeout(saveTimer[id]);
  if (creating.has(id)) deleteAfterCreate.add(id);
  else void deleteRemote(id, note);
}

// ─── Auto-prune empty notes/blocks (on nav-away) ───

function isBlockEmpty(b: NoteBlock): boolean {
  if (b.type === 'text') return !b.md.trim();
  if (b.type === 'todo') return b.items.every((it) => !it.text.trim());
  return b.items.length === 0; // easel
}

/** A note with no title and no content at all (empty check "bubbles up"). */
function noteIsEmpty(n: AgentNote): boolean {
  if (n.title.trim()) return false;
  if (n.kind === 'todo') return n.items.every((it) => !it.text.trim());
  if (n.kind === 'easel') return n.easel.items.length === 0;
  // note kind: empty body + no attachments + every embedded block empty
  if (n.attachments.length > 0) return false;
  if (n.body.trim()) return false;
  return n.blocks.every(isBlockEmpty);
}

/**
 * Drop empty embedded blocks (boards/todos) and, if the whole note is then empty,
 * delete it. Called when the user navigates away without adding content.
 */
export function pruneEmptyNote(id: string): void {
  const n = find(id);
  if (!n) return;
  if (n.kind === 'note') {
    // Remove empty to-do/easel blocks (keep text blocks).
    const kept = n.blocks.filter((b) => b.type === 'text' || !isBlockEmpty(b));
    if (kept.length !== n.blocks.length) {
      n.blocks = kept.length > 0 ? kept : [{ id: uid(), type: 'text', md: '', attachments: [] }];
    }
  }
  if (noteIsEmpty(n)) deleteNote(n.id);
  else if (n.kind === 'note' && n.blocks.length === 0) {
    n.blocks.push({ id: uid(), type: 'text', md: '', attachments: [] });
    touch(n);
  } else if (n.kind === 'note') {
    touch(n);
  }
}

/** Prune every note (e.g. when the notes view unmounts / page navigates away). */
export function pruneEmptyNotes(): void {
  for (const n of [...notesState.notes]) pruneEmptyNote(n.id);
}

/**
 * The first empty `note`-kind note, if any. Used to keep at most one empty note:
 * the "+" button focuses it instead of creating another.
 */
export function firstEmptyNote(): AgentNote | undefined {
  return notesState.notes.find((n) => n.kind === 'note' && noteIsEmpty(n));
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
