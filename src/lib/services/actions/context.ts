import { getContext, setContext } from 'svelte';
import type { ActionRuntime } from './runtime.svelte';

const actionContext = Symbol('hub-actions');

export function provideActions(runtime: ActionRuntime): ActionRuntime {
  return setContext(actionContext, runtime);
}

export function useActions(): ActionRuntime {
  const runtime = getContext<ActionRuntime | undefined>(actionContext);
  if (!runtime) throw new Error('Action runtime must be provided by the application layout');
  return runtime;
}

/** Optional integration for standalone component consumers and tests. */
export function tryUseActions(): ActionRuntime | undefined {
  return getContext<ActionRuntime | undefined>(actionContext);
}
