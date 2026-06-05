import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getNotesCtx } from '$server/auth/notes-ctx';
import { updateNote, deleteNote, type UpdateNoteInput } from '$server/services/notes.service';

/** PUT /api/notes/[id] — update a note the caller owns. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  const ctx = await getNotesCtx(locals);
  if (!ctx) throw error(401);

  const patch = (await request.json().catch(() => ({}))) as UpdateNoteInput;
  const note = await updateNote(ctx, params.id!, patch);
  if (!note) throw error(404, 'Note not found');
  return json({ note });
};

/** DELETE /api/notes/[id] — delete a note the caller owns. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await getNotesCtx(locals);
  if (!ctx) throw error(401);

  const ok = await deleteNote(ctx, params.id!);
  if (!ok) throw error(404, 'Note not found');
  return json({ ok: true });
};
