import { browser } from '$app/environment';
import type { NavConfig } from './custom-sections';

/**
 * Universal reroute for custom-nav instance paths (spec 037, D7/D9):
 * `/<section>/<slug>~<id>/<rest>` renders the target's route subtree.
 * Only paths whose SECOND segment carries the marker are ever consulted, so
 * every canonical URL stays zero-cost (no fetch, no DB).
 */
export const INSTANCE_MARKER = '~';

/** id → target (null = known miss). Browser only; seeded from the layout's nav config. */
const idCache = new Map<string, string | null>();

export function setInstanceMap(config?: NavConfig): void {
  idCache.clear();
  if (!config) return;
  const pages = [
    ...config.sections.flatMap((s) => s.pages),
    ...Object.values(config.builtinSections).flat(),
  ];
  for (const p of pages) idCache.set(p.id, p.target);
}

export async function resolveAliasPath(
  pathname: string,
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  const [, first, second] = pathname.split('/');
  if (!first || !second || !second.includes(INSTANCE_MARKER)) return undefined;
  if (/\.[a-z0-9]+$/i.test(pathname)) return undefined;
  const id = second.slice(second.lastIndexOf(INSTANCE_MARKER) + 1);
  const rest = pathname.slice(`/${first}/${second}`.length);
  if (browser && idCache.has(id)) {
    const hit = idCache.get(id);
    return hit ? hit + rest : undefined;
  }
  try {
    const res = await fetchFn(`/api/nav/resolve?path=${encodeURIComponent(pathname)}`);
    const target: string | null = res.ok
      ? (((await res.json()) as { target?: string }).target ?? null)
      : null;
    if (browser) idCache.set(id, target);
    return target ? target + rest : undefined;
  } catch {
    return undefined;
  }
}
