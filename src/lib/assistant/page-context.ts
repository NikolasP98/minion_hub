import { onToolChange } from './model-context';
import { mayPublishInvocation, type InvocationCapability } from './accepted-runs';

let text = '';
let owner: symbol | null = null;
let revision = 0;
let location = '';
export interface PageContextChange {
  kind: 'external' | 'owned';
  previousRevision: number;
  revision: number;
  lease: symbol | null;
  capability?: InvocationCapability;
}
const listeners = new Set<(change: PageContextChange) => void>();
function changed(capability?: InvocationCapability) {
  const previousRevision = revision++;
  const change: PageContextChange = {
    kind: capability ? 'owned' : 'external',
    previousRevision,
    revision,
    lease: owner,
    capability,
  };
  for (const listener of listeners) listener(change);
}
onToolChange(() => changed());
/** Stable page lifetime. A tool can update only the lease it was admitted against. */
export function createPageContextLease(value: string) {
  const token = Symbol('page-context');
  owner = token;
  text = value;
  changed();
  return {
    token,
    invalidate() {
      if (owner === token) changed();
    },
    update(value: string, capability?: InvocationCapability): boolean {
      if (owner !== token) return false;
      if (capability && !mayPublishInvocation(capability, token)) {
        changed();
        return false;
      }
      text = value;
      changed(capability);
      return true;
    },
    dispose() {
      if (owner !== token) return;
      owner = null;
      text = '';
      changed();
    },
  };
}
export function setPageContext(value: string): () => void {
  return createPageContextLease(value).dispose;
}
export function getPageContextLease(): symbol | null {
  return owner;
}
export function setPageContextLocation(value: string): void {
  if (value === location) return;
  location = value;
  changed();
}
export function getPageContext(): string {
  return text;
}
export function getPageContextRevision(): number {
  return revision;
}
export function onPageContextChange(listener: (change: PageContextChange) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
