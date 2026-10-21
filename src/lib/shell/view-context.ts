import { getContext, setContext } from 'svelte';
import { ViewMemory } from './view-memory';
const KEY = Symbol('hub-view-memory');
export function provideViewMemory(): ViewMemory {
  return setContext(KEY, new ViewMemory());
}
export function useViewMemory(): ViewMemory | undefined {
  return getContext<ViewMemory | undefined>(KEY);
}
