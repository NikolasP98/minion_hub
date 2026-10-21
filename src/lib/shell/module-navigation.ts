import { page } from '$app/state';
import { goto } from '$lib/navigation';
import { canonicalPath } from '$lib/canonical-path';
import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
import { useViewMemory } from './view-context';
import type { ViewMemory } from './view-memory';

/** Only shell module selectors opt into resumption. Ordinary links, assistant
 * navigation and browser history always keep their literal URL contract. */
export function resumeModuleHref(
  memory: ViewMemory | undefined,
  owner: string | null,
  from: URL,
  href: string,
): string {
  const target = new URL(href, from);
  if (target.origin !== from.origin || target.search || target.hash) return href;
  const path = canonicalPath(target.pathname).replace(/\/$/, '');
  const module = path.split('/')[1];
  if (!module || path !== `/${module}` || canonicalPath(from.pathname).split('/')[1] === module)
    return href;
  return memory?.read<string>(owner, `module:${module}`) ?? href;
}

export function createModuleNavigation() {
  const memory = useViewMemory();
  const resolve = (href: string) => resumeModuleHref(memory, preferenceOwner(), page.url, href);
  return {
    go: (href: string) => goto(resolve(href)),
    link(node: HTMLAnchorElement) {
      const click = (event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          node.target ||
          node.hasAttribute('download')
        )
          return;
        const href = resolve(node.href);
        if (new URL(href, page.url).href === node.href) return;
        event.preventDefault();
        void goto(href);
      };
      node.addEventListener('click', click);
      return { destroy: () => node.removeEventListener('click', click) };
    },
  };
}
