import { resolvePath, type SitePage } from './site-map';

export interface NavigationProposal {
  ok: true;
  navigated: false;
  requiresUserAction: true;
  path: string;
  href: string;
  title: string;
}

/** A link offer only. Call with current permissions again when the user clicks. */
export function navigationProposal(
  input: Record<string, unknown>,
  pages: SitePage[],
  canView: (path: string) => boolean,
): NavigationProposal | { error: string } {
  const raw = input.path;
  if (typeof raw !== 'string' || !/^\/[a-z0-9/_-]*$/i.test(raw) || raw.startsWith('//'))
    return { error: 'Expected a canonical internal page path' };
  const resolved = resolvePath(raw, pages);
  if (!resolved.ok) return { error: resolved.reason };
  if (!canView(resolved.path)) return { error: 'Page is not available' };
  const params = input.params === undefined ? {} : input.params;
  if (
    !params ||
    typeof params !== 'object' ||
    Array.isArray(params) ||
    (Object.getPrototypeOf(params) !== Object.prototype &&
      Object.getPrototypeOf(params) !== null) ||
    Object.values(params).some((value) => typeof value !== 'string')
  )
    return { error: 'Expected string query parameters' };
  const query = new URLSearchParams(Object.entries(params) as [string, string][]).toString();
  return {
    ok: true,
    navigated: false,
    requiresUserAction: true,
    path: resolved.path,
    href: resolved.path + (query ? `?${query}` : ''),
    title: pages.find((page) => page.path === resolved.path)?.title ?? resolved.path,
  };
}
