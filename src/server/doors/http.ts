import { json } from '@sveltejs/kit';
import { errorBody } from '$server/http/error-body';
import { DoorError } from '$server/services/doors.service';

/** Maps a DoorError to `{ message, error: code, code, issues? }` with its status; rethrows anything else. */
export function doorErrorResponse(e: unknown): Response {
  if (e instanceof DoorError)
    return json(
      errorBody(e.code, e.code, { error: e.code, ...(e.issues ? { issues: e.issues } : {}) }),
      {
        status: e.status,
      },
    );
  throw e;
}
