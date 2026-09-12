import { json } from '@sveltejs/kit';
import { AttachmentError } from '$server/services/attachments.service';

// Leading underscore = not a SvelteKit route module, just a shared helper for
// the attachments API routes. Mirrors pos/_errors.ts and stock/_errors.ts —
// a thrown plain Response becomes a 500 (SvelteKit's render_endpoint only
// special-cases thrown Redirects), so callers must `return` this.
const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  upload_missing: 404,
  too_large: 413,
  quota_exceeded: 413,
  mime_not_allowed: 415,
  still_linked: 409,
};

/** Maps an AttachmentError to an `{error, code}` json Response (caller must RETURN it); re-throws anything else untouched. */
export function handleAttachmentError(e: unknown): Response {
  if (e instanceof AttachmentError) {
    return json({ error: e.message, code: e.code }, { status: STATUS_BY_CODE[e.code] ?? 400 });
  }
  throw e;
}
