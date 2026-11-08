<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { createAutosave } from '$lib/records/autosave.svelte';
  import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
  import { provideActions } from '$lib/services/actions/context';
  let {
    scope = 'actor-a',
    committed = 'server-a',
    write = async (_value: string) => {},
  }: {
    scope?: string;
    committed?: string;
    write?: (value: string) => Promise<void>;
  } = $props();
  const actions = provideActions(createActionRuntime());
  // Same ordering as the app root: autosave is constructed before this effect initializes its scope.
  $effect(() => {
    const next = scope;
    untrack(() => actions.setScope(next));
  });
  const field = createAutosave({
    committed: () => committed,
    scope: () => scope,
    save: (value: string) => write(value),
    debounceMs: 0,
  });
  const value = $derived(field.value);
  const status = $derived(field.status);
  onDestroy(() => actions.dispose());
</script>

<input aria-label="Value" {value} oninput={(event) => field.set(event.currentTarget.value)} />
<output data-testid="value">{value}</output>
<output data-testid="status">{status}</output>
