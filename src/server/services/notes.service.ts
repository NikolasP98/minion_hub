import { and, desc, eq } from 'drizzle-orm';
import { notes, type NoteRow } from '$server/db/pg-schema/notes';
import type { NotesCtx } from '$server/auth/notes-ctx';
import {
  NOTE_KINDS,
  defaultNoteData,
  parseNoteData,
  type NoteColor,
  type NoteDocument,
  type NoteKind,
} from '$lib/types/notes';

/** A note as returned to the client — `data` is parsed into its document shape. */
export interface Note {
  id: string;
  kind: NoteKind;
  title: string;
  color: NoteColor;
  pinned: boolean;
  data: NoteDocument;
  createdAt: number;
  updatedAt: number;
}

export interface CreateNoteInput {
  kind?: NoteKind;
  title?: string;
  color?: NoteColor;
  data?: unknown;
}

export interface UpdateNoteInput {
  title?: string;
  color?: NoteColor;
  pinned?: boolean;
  data?: unknown;
}

function toNote(row: NoteRow): Note {
  const kind = (NOTE_KINDS as readonly string[]).includes(row.kind)
    ? (row.kind as NoteKind)
    : 'note';
  return {
    id: row.id,
    kind,
    title: row.title,
    color: (row.color as NoteColor) ?? 'default',
    pinned: row.pinned,
    data: parseNoteData(kind, row.data),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Owner filter — every query is scoped to the caller's tenant AND user. */
function owner(ctx: NotesCtx) {
  return and(eq(notes.tenantId, ctx.tenantId), eq(notes.userId, ctx.userId));
}

function uid(): string {
  return crypto.randomUUID();
}

/** List the caller's notes, pinned-first then most-recently-updated. */
export async function listNotes(ctx: NotesCtx): Promise<Note[]> {
  const rows = await ctx.db.select().from(notes).where(owner(ctx)).orderBy(desc(notes.updatedAt));
  // Pinned first (stable); DB already orders by updatedAt desc within each group.
  return rows.map(toNote).sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1));
}

export async function createNote(ctx: NotesCtx, input: CreateNoteInput): Promise<Note> {
  const kind: NoteKind = (NOTE_KINDS as readonly string[]).includes(input.kind ?? '')
    ? (input.kind as NoteKind)
    : 'note';
  const now = Date.now();
  // Validate/normalize the document for this kind (defaults if none supplied).
  const data = parseNoteData(kind, input.data ?? defaultNoteData(kind));
  const row: NoteRow = {
    id: uid(),
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    kind,
    title: (input.title ?? '').slice(0, 500),
    color: input.color ?? 'default',
    pinned: false,
    data: JSON.stringify(data),
    createdAt: now,
    updatedAt: now,
  };
  await ctx.db.insert(notes).values(row);
  return toNote(row);
}

/** Update a note the caller owns. Returns null if it doesn't exist / isn't theirs. */
export async function updateNote(
  ctx: NotesCtx,
  id: string,
  patch: UpdateNoteInput,
): Promise<Note | null> {
  const [existing] = await ctx.db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), owner(ctx)))
    .limit(1);
  if (!existing) return null;

  const kind = (NOTE_KINDS as readonly string[]).includes(existing.kind)
    ? (existing.kind as NoteKind)
    : 'note';

  const set: Partial<NoteRow> = { updatedAt: Date.now() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 500);
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.pinned !== undefined) set.pinned = patch.pinned;
  if (patch.data !== undefined) set.data = JSON.stringify(parseNoteData(kind, patch.data));

  await ctx.db.update(notes).set(set).where(and(eq(notes.id, id), owner(ctx)));
  return toNote({ ...existing, ...set } as NoteRow);
}

/** Delete a note the caller owns. Returns true if a row was removed. */
export async function deleteNote(ctx: NotesCtx, id: string): Promise<boolean> {
  const [existing] = await ctx.db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, id), owner(ctx)))
    .limit(1);
  if (!existing) return false;
  await ctx.db.delete(notes).where(and(eq(notes.id, id), owner(ctx)));
  return true;
}
