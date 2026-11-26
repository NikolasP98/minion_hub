/**
 * Page values (spec 150): what each filter currently holds, per viewer and per
 * open page. A `ValuesSource` is the storage seam: S1 ships `localValues`
 * (memory, starting from the filter defaults); S2 adds `urlValues` so a value
 * lives in the link. The page never reads storage directly.
 */
import { createDebouncer } from '$lib/pacer/index.svelte';
import type { PageValue } from './blocks/schema';
import type { Binding } from './blocks/query';
import type { Publisher } from './wiring-types';

export interface ValuesSource {
  get(name: string): PageValue | null;
  /** `null` clears the value: the filter then publishes nothing. */
  set(name: string, value: PageValue | null): void;
}

/**
 * In-memory values. A name nobody touched reads the filter default (the lowest
 * `position` publisher wins for duplicates); a name that was set, even to
 * `null`, reads exactly that. `publishers` is a getter so a filter the agent
 * adds later is picked up.
 */
export function localValues(publishers: () => Publisher[]): ValuesSource {
  const touched = $state<Record<string, PageValue | null>>({});
  return {
    get(name) {
      if (name in touched) return touched[name] ?? null;
      const list = publishers()
        .filter((p) => p.var === name)
        .sort((a, b) => a.position - b.position);
      return list.find((p) => p.default)?.default ?? null;
    },
    set(name, value) {
      touched[name] = value;
    },
  };
}

/** The connections that currently have a value, as the query layer's `Binding`s. */
export function resolveBindings(
  connections: ReadonlyArray<{ var: string; col: string }>,
  read: (name: string) => PageValue | null,
): Binding[] {
  const out: Binding[] = [];
  for (const { var: name, col } of connections) {
    const value = read(name);
    if (value) out.push({ col, value });
  }
  return out;
}

/** Stable identity of a binding list: a block reloads only when this string changes. */
export const bindingKey = (bindings: readonly Binding[]) =>
  bindings.length === 0 ? '' : JSON.stringify(bindings);

/** Matches the settle time of every other debounced control in the hub. */
export const SETTLE_MS = 250;

/**
 * Debounces control changes (FR-005): the controls read `draft` (instant
 * feedback), blocks read `applied` (settles `wait` ms after the LAST change).
 * One debouncer per page; changes to several filters inside the window all
 * land together. Component-init only (`createDebouncer` registers an effect).
 */
export function createPageValues(source: ValuesSource, wait = SETTLE_MS) {
  let draft = $state<Record<string, PageValue | null>>({});
  let pending: Array<[string, PageValue | null]> = [];
  const settle = createDebouncer(
    () => {
      for (const [name, value] of pending) source.set(name, value);
      pending = [];
      draft = {};
    },
    { wait },
  );
  return {
    /** What a control shows: the unsettled change if there is one. */
    draft(name: string): PageValue | null {
      return name in draft ? (draft[name] ?? null) : source.get(name);
    },
    /** What blocks query with. */
    applied: (name: string) => source.get(name),
    set(name: string, value: PageValue | null) {
      draft[name] = value;
      pending.push([name, value]);
      settle.run();
    },
    flush: () => settle.flush(),
    cancel: () => settle.cancel(),
  };
}
