import { mergeFieldLayout, moveField, visibleFields } from './card-fields';

export interface CardFields {
  readonly hidden: ReadonlySet<string>;
  readonly order: string[];
  /** Order minus hidden — what the card renders, in sequence. */
  readonly visible: string[];
  toggle(key: string): void;
  move(from: string, to: string): void;
}

/**
 * Per-viewer card field layout for one surface, persisted in localStorage
 * under `cards:<ns>` (every read/write try/catch'ed — a per-viewer convenience,
 * never state the app depends on). The key string is part of the contract:
 * renaming it silently resets every viewer.
 */
export function createCardFields(
  ns: string,
  catalog: readonly string[],
  defaultHidden: readonly string[] = [],
): CardFields {
  const key = `cards:${ns}`;
  let stored: { hidden?: string[]; order?: string[] } | null = null;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if (raw) stored = JSON.parse(raw) as { hidden?: string[]; order?: string[] };
    }
  } catch {
    stored = null;
  }
  const initial = mergeFieldLayout(catalog, stored, defaultHidden);
  let hidden = $state(new Set(initial.hidden));
  let order = $state(initial.order);
  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify({ hidden: [...hidden], order }));
    } catch {
      /* per-viewer convenience only */
    }
  };
  return {
    get hidden() {
      return hidden;
    },
    get order() {
      return order;
    },
    get visible() {
      return visibleFields({ hidden, order });
    },
    toggle(k) {
      const next = new Set(hidden);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      hidden = next;
      persist();
    },
    move(from, to) {
      order = moveField(order, from, to);
      persist();
    },
  };
}
