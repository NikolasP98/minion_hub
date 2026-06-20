/**
 * Svelte action: relocate the node to `document.body` (or a given target) so it
 * escapes ancestor stacking contexts and `overflow:hidden`. Use for floating
 * surfaces — e.g. fullscreen agent windows that must render above the app
 * shell's `z-10` container (sidebar, topbar, assistant pill). Actions run only
 * in the browser, so this is SSR-safe.
 */
export function portal(node: HTMLElement, target: HTMLElement | string = document.body) {
  let host: HTMLElement | null = null;

  function mount(to: HTMLElement | string) {
    host = typeof to === 'string' ? document.querySelector<HTMLElement>(to) : to;
    (host ?? document.body).appendChild(node);
  }

  mount(target);

  return {
    update(to: HTMLElement | string) {
      mount(to);
    },
    destroy() {
      node.remove();
    },
  };
}
