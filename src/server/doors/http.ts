import { json } from '@sveltejs/kit';
import { DoorError } from '$server/services/doors.service';

/** Maps a DoorError to `{ error: code, issues? }` with its status; rethrows anything else. */
export function doorErrorResponse(e: unknown): Response {
  if (e instanceof DoorError)
    return json({ error: e.code, ...(e.issues ? { issues: e.issues } : {}) }, { status: e.status });
  throw e;
}
