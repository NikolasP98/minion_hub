import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { assertSafeUrl, SsrfBlockedError } from '$server/services/ssrf-guard';
import { uploadFile } from '$server/services/file.service';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

/**
 * POST /api/notes/fetch-image  { url }
 *
 * Re-hosts a remote image URL: SSRF-validates the host (and every redirect hop),
 * fetches the bytes, and stores them in B2 via the existing file service. Returns
 * the stable `fileId` so the note references our copy (rendered through
 * /api/files/<fileId>/raw) — not the third-party URL.
 *
 * Dimensions are measured client-side after load, so we don't pull an image lib
 * in just for width/height (returns w/h = 0).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url || typeof url !== 'string') throw error(400, 'url is required');

  let fetched: { data: Uint8Array; contentType: string; fileName: string };
  try {
    fetched = await fetchImageSafely(url);
  } catch (e) {
    if (e instanceof SsrfBlockedError) throw error(400, 'That URL is not allowed.');
    if (e instanceof FetchImageError) throw error(e.status, e.message);
    throw error(502, 'Could not fetch that image.');
  }

  const fileId = await uploadFile(ctx, {
    fileName: fetched.fileName,
    contentType: fetched.contentType,
    data: fetched.data,
    category: 'notes',
    uploadedBy: locals.user?.id,
  });

  return json({ fileId, w: 0, h: 0 });
};

class FetchImageError extends Error {
  constructor(
    public status: 400 | 413 | 415 | 502 | 504,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Fetch an image with SSRF protection on every hop, a hard size cap, an
 * image/* content-type check, and a timeout. Redirects are followed manually so
 * each Location is re-validated (a 302 → internal IP must not slip through).
 */
async function fetchImageSafely(
  startUrl: string,
): Promise<{ data: Uint8Array; contentType: string; fileName: string }> {
  let current = startUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertSafeUrl(current, 'image URL');
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'image/*' },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new FetchImageError(502, 'Redirect without a location.');
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new FetchImageError(502, `Upstream returned ${res.status}.`);

      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) {
        throw new FetchImageError(415, 'That URL is not an image.');
      }

      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared && declared > MAX_BYTES) {
        throw new FetchImageError(413, 'That image is too large (max 10 MB).');
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        throw new FetchImageError(413, 'That image is too large (max 10 MB).');
      }

      return { data: buf, contentType, fileName: fileNameFor(current, contentType) };
    }
    throw new FetchImageError(502, 'Too many redirects.');
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new FetchImageError(504, 'Fetching that image timed out.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function fileNameFor(url: string, contentType: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last.slice(0, 120);
  } catch {
    /* fall through */
  }
  const ext = contentType.split('/')[1]?.replace('+xml', '') ?? 'png';
  return `image.${ext}`;
}
