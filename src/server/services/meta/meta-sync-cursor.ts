/** `cs` = the ads sync's current time-window since-date (chunked pulls only);
 *  `f` = consecutive failed attempts at that window (parked-for-retry). */
export type Resume = { i: number; next?: string; cs?: string; f?: number };
export function parseResume(pageCursor: string | null): Resume {
  if (!pageCursor) return { i: 0 };
  try {
    const p = JSON.parse(pageCursor) as Partial<Resume>;
    return typeof p.i === 'number' ? { i: p.i, next: p.next, cs: p.cs, f: p.f } : { i: 0 };
  } catch {
    return { i: 0 };
  }
}

export function sanitizeGraphPagingUrl(nextUrl: string | undefined): string | undefined {
  if (!nextUrl) return undefined;
  try {
    const url = new URL(nextUrl);
    url.searchParams.delete('access_token');
    url.searchParams.delete('appsecret_proof');
    return url.toString();
  } catch {
    return undefined;
  }
}

export const serializeResume = (r: Resume): string =>
  JSON.stringify({ ...r, next: sanitizeGraphPagingUrl(r.next) });

/** Advance from an already persisted page, even when that terminal page used
 * the entire slice budget. Missing next-page is exhaustion, never page one. */
export function cursorAfterPage(options: {
  i: number;
  targetCount: number;
  nextPage?: string;
  currentWindow?: string;
  nextWindow?: string;
}): string | null {
  if (options.nextPage) {
    const next = sanitizeGraphPagingUrl(options.nextPage);
    if (!next) throw new Error('Invalid Meta paging cursor');
    return serializeResume({ i: options.i, next, cs: options.currentWindow });
  }
  if (options.nextWindow) return serializeResume({ i: options.i, cs: options.nextWindow });
  if (options.i + 1 < options.targetCount) return serializeResume({ i: options.i + 1 });
  return null;
}
