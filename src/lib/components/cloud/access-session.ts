/**
 * Tracks the workstation identity that owns a live browser access session.
 * Shell metadata is polled and replaced frequently; only a different shell id
 * is allowed to tear down and recreate the GUI or terminal transport.
 */
export class AccessSessionSelection {
  #shellId: string | null = null;

  select(shellId: string): boolean {
    if (this.#shellId === shellId) return false;
    this.#shellId = shellId;
    return true;
  }
}
