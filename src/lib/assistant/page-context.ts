import { onToolChange } from './model-context';

let text = '';
let owner: symbol | null = null;
let revision = 0;
let location = '';
const listeners = new Set<() => void>();
function changed() {
  revision++;
  for (const listener of listeners) listener();
}
// Tools are part of the page envelope even when its prose remains equal.
onToolChange(changed);

/** Each registration owns an opaque token, including registrations with equal prose. */
export function setPageContext(value: string): () => void {
  const token = Symbol('page-context');
  owner = token;
  text = value;
  changed();
  return () => {
    if (owner !== token) return;
    owner = null;
    text = '';
    changed();
  };
}
/** Pass route plus focus/query state from the mounted surface. */
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
export function onPageContextChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
