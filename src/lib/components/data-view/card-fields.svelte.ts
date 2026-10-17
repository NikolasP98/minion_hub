import { mergeFieldLayout, moveField } from './card-fields';
import { createScopedPreference } from '$lib/state/ui/scoped-preference.svelte';
export interface CardFields {
  readonly hidden: ReadonlySet<string>;
  readonly order: string[];
  readonly visible: string[];
  toggle(key: string): void;
  move(from: string, to: string): void;
}
export function createCardFields(
  ns: string,
  catalog: readonly string[],
  defaultHidden: readonly string[] = [],
): CardFields {
  const normalize = (value: unknown) => {
    const l = mergeFieldLayout(catalog, value, defaultHidden);
    return { version: 1, hidden: [...l.hidden], order: l.order };
  };
  const pref = createScopedPreference(`cards:${ns}`, () => normalize(null), normalize);
  return {
    get hidden() {
      return new Set(pref.value.hidden);
    },
    get order() {
      return pref.value.order;
    },
    get visible() {
      const l = pref.value;
      return l.order.filter((k) => !l.hidden.includes(k));
    },
    toggle(key) {
      if (!catalog.includes(key)) return;
      const l = pref.value;
      pref.set({
        ...l,
        hidden: l.hidden.includes(key) ? l.hidden.filter((k) => k !== key) : [...l.hidden, key],
      });
    },
    move(from, to) {
      const l = pref.value;
      pref.set({ ...l, order: moveField(l.order, from, to) });
    },
  };
}
