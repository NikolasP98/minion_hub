import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
export interface DropDestination {
  id: string;
  label: string;
  /** Includes current permission/record/connection state; evaluated at use. */
  available: () => boolean;
  receive: (files: File[], signal: AbortSignal) => Promise<void>;
}
export class DropUnavailableError extends Error {}
export class DropRegistry {
  destinations = new SvelteMap<string, DropDestination>();
  open = $state(false);
  register(destination: DropDestination): () => void {
    this.destinations.set(destination.id, destination);
    return () => {
      if (this.destinations.get(destination.id) === destination)
        this.destinations.delete(destination.id);
    };
  }
  get available(): DropDestination[] {
    return [...this.destinations.values()].filter((destination) => destination.available());
  }
  async deliver(destination: DropDestination, files: File[], signal: AbortSignal): Promise<void> {
    if (
      signal.aborted ||
      this.destinations.get(destination.id) !== destination ||
      !destination.available()
    )
      throw new DropUnavailableError('Drop destination is no longer available');
    await destination.receive(files, signal);
  }
}
const KEY = Symbol('hub-drop-registry');
export const provideDropRegistry = () => setContext(KEY, new DropRegistry());
export const useDropRegistry = () => getContext<DropRegistry | undefined>(KEY);
export const isFileDrag = (transfer: Pick<DataTransfer, 'types'> | null) =>
  !!transfer?.types.includes('Files');
