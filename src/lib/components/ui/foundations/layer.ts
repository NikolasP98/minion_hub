export const LAYER_TIERS = [
  'base',
  'sticky',
  'navigation',
  'dropdown',
  'popover',
  'modal',
  'toast',
  'command',
  'debug',
] as const;

export type LayerTier = (typeof LAYER_TIERS)[number];

export type PortalTarget = 'body' | string | HTMLElement;

export type PortalOptions = {
  target?: PortalTarget;
  disabled?: boolean;
};

function resolveTarget(target: PortalTarget | undefined): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (target instanceof HTMLElement) return target;
  return document.querySelector(target ?? 'body');
}

/**
 * Moves an element to a stable overlay root after hydration and returns it to
 * its source position on teardown. The wrapper uses `display: contents`, so it
 * never becomes an accidental layout or stacking-context boundary.
 */
export function portal(node: HTMLElement, options: PortalOptions = {}) {
  const origin = node.parentNode;
  const marker = document.createComment('minion-portal');
  origin?.insertBefore(marker, node);

  function move(next: PortalOptions) {
    if (next.disabled) {
      marker.parentNode?.insertBefore(node, marker.nextSibling);
      return;
    }

    const destination = resolveTarget(next.target);
    if (!destination) {
      throw new Error(`Portal target not found: ${String(next.target ?? 'body')}`);
    }
    destination.appendChild(node);
  }

  move(options);

  return {
    update: move,
    destroy() {
      marker.parentNode?.insertBefore(node, marker.nextSibling);
      marker.remove();
    },
  };
}
