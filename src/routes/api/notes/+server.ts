import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getNotesCtx } from '$server/auth/notes-ctx';
import { listNotes, createNote, type CreateNoteInput } from '$server/services/notes.service';

/** GET /api/notes — list the current user's notes (pinned first). */
export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  const ctx = await getNotesCtx(locals);
  if (!ctx) throw error(401);
  return json({ notes: await listNotes(ctx) });
};

/** POST /api/notes — create a note/todo/easel. */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);
  const ctx = await getNotesCtx(locals);
  if (!ctx) throw error(401);

  const body = (await request.json().catch(() => ({}))) as CreateNoteInput;
  const note = await createNote(ctx, body);
  return json({ note }, { status: 201 });
};
