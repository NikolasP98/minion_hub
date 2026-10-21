/** Session-only view state. No records, credentials or drafts go to browser storage. */
export class ViewMemory {
  #owner: string | null = null;
  #entries = new Map<string, unknown>();
  #captures = new Set<() => void>();
  #slots = new Map<string, Set<number>>();
  constructor(private readonly limit = 80) {}
  reconcile(owner: string | null): void {
    if (owner === this.#owner) return;
    this.#owner = owner;
    this.#entries.clear();
  }
  read<T>(owner: string | null, key: string): T | undefined {
    if (!owner || owner !== this.#owner) return;
    return this.#entries.get(key) as T | undefined;
  }
  write<T>(owner: string | null, key: string, value: T): void {
    // Late teardown from the previous owner must never resurrect their state.
    if (!owner || owner !== this.#owner) return;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.limit)
      this.#entries.delete(this.#entries.keys().next().value!);
  }
  /** Stable lifetime slots for module tables without a registry id. They do
   * not depend on DOM binding/mount timing and cannot collide with siblings. */
  claim(namespace: string): { id: number; release: () => void } {
    let slots = this.#slots.get(namespace);
    if (!slots) {
      slots = new Set();
      this.#slots.set(namespace, slots);
    }
    let id = 0;
    while (slots.has(id)) id++;
    slots.add(id);
    const ownedSlots = slots;
    let active = true;
    return {
      id,
      release: () => {
        if (!active) return;
        active = false;
        ownedSlots.delete(id);
        if (!ownedSlots.size && this.#slots.get(namespace) === ownedSlots)
          this.#slots.delete(namespace);
      },
    };
  }
  register(capture: () => void): () => void {
    this.#captures.add(capture);
    return () => this.#captures.delete(capture);
  }
  capture(): void {
    for (const capture of this.#captures) capture();
  }
}

export function viewKey(url: URL): string {
  // Hash targets and query strings are authoritative. No remembered state from
  // another deep link may override them. Locale remains part of the identity.
  const params = new URLSearchParams(url.search);
  params.sort();
  return `${url.pathname}?${params}${url.hash}`;
}
