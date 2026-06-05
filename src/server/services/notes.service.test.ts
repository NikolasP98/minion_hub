import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import type { NotesCtx } from '$server/auth/notes-ctx';
import { listNotes, createNote, updateNote, deleteNote } from './notes.service';
import type { NoteData, TodoData, EaselData } from '$lib/types/notes';

function ctxWith(db: ReturnType<typeof createMockDb>['db']): NotesCtx {
  // The mock db is typed as the LibSQL client; NotesCtx wants the PG client.
  // The mock is structurally a stand-in, so cast through unknown.
  return { db, tenantId: 'org-1', userId: 'user-1' } as unknown as NotesCtx;
}

describe('createNote', () => {
  it('defaults to a note kind with an empty markdown body', async () => {
    const { db } = createMockDb();
    const note = await createNote(ctxWith(db), {});
    expect(note.kind).toBe('note');
    expect((note.data as NoteData).body).toBe('');
    expect((note.data as NoteData).attachments).toEqual([]);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('normalizes a todo document, dropping unknown fields', async () => {
    const { db } = createMockDb();
    const note = await createNote(ctxWith(db), {
      kind: 'todo',
      data: { items: [{ id: 'a', text: 'buy milk', done: false, bogus: 1 }], junk: true },
    });
    expect(note.kind).toBe('todo');
    const data = note.data as TodoData;
    expect(data.items).toEqual([{ id: 'a', text: 'buy milk', done: false }]);
    expect(data.attachments).toEqual([]);
  });

  it('validates easel image items and defaults rotation/z', async () => {
    const { db } = createMockDb();
    const note = await createNote(ctxWith(db), {
      kind: 'easel',
      data: { items: [{ id: 'i1', type: 'image', fileId: 'f1', x: 10, y: 20, w: 100, h: 80 }] },
    });
    const data = note.data as EaselData;
    expect(data.items[0]).toMatchObject({ type: 'image', fileId: 'f1', rotation: 0, z: 0 });
  });

  it('falls back to empty data when the document is garbage', async () => {
    const { db } = createMockDb();
    const note = await createNote(ctxWith(db), { kind: 'note', data: 'not json {' });
    expect((note.data as NoteData).body).toBe('');
  });
});

describe('listNotes', () => {
  it('returns pinned notes first', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'a', tenantId: 'org-1', userId: 'user-1', kind: 'note', title: 'A', color: 'default', pinned: false, data: '{}', createdAt: 2, updatedAt: 2 },
      { id: 'b', tenantId: 'org-1', userId: 'user-1', kind: 'note', title: 'B', color: 'default', pinned: true, data: '{}', createdAt: 1, updatedAt: 1 },
    ]);
    const out = await listNotes(ctxWith(db));
    expect(out.map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('updateNote', () => {
  it('returns null when the note is not owned / not found', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // select finds nothing
    const out = await updateNote(ctxWith(db), 'missing', { title: 'x' });
    expect(out).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('applies a patch and re-validates data against the existing kind', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'a', tenantId: 'org-1', userId: 'user-1', kind: 'todo', title: 'A', color: 'default', pinned: false, data: '{"items":[],"attachments":[]}', createdAt: 1, updatedAt: 1 },
    ]);
    const out = await updateNote(ctxWith(db), 'a', {
      pinned: true,
      data: { items: [{ id: 'x', text: 'do', done: true }] },
    });
    expect(out?.pinned).toBe(true);
    expect((out?.data as TodoData).items[0]).toMatchObject({ id: 'x', done: true });
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe('deleteNote', () => {
  it('returns false when nothing matches', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await deleteNote(ctxWith(db), 'nope')).toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('removes an owned note', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'a' }]);
    expect(await deleteNote(ctxWith(db), 'a')).toBe(true);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
