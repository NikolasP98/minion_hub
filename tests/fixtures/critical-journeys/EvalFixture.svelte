<script lang="ts">
  import { onMount, type ComponentProps } from 'svelte';
  import Shell from '../mobile-composition/Shell.svelte';
  import Home from '../../../src/routes/(app)/home/+page.svelte';
  import Floating from '../../../src/lib/components/layout/FloatingAssistant.svelte';
  import Sandbox from '../../../src/routes/(app)/sandbox/+page.svelte';
  import { assistant } from '$lib/state/features/assistant.svelte';
  import { bootstrap } from './eval-page.svelte';
  import { initialSandboxElements } from './eval-state';
  import { registerGlobalTools } from '$lib/assistant/global-tools';
  import { begin, stop } from './gateway-transport';
  const data = {
    userName: 'Fixture User',
    greeting: 'Disposable assistant evaluation',
    openedIds: [],
  } as ComponentProps<typeof Home>['data'];
  const sandboxData = {
    elements: initialSandboxElements(bootstrap?.initialState ?? 'empty'),
  } as ComponentProps<typeof Sandbox>['data'];
  let sandboxMounted = $state(bootstrap?.sandbox ?? false);
  onMount(() => {
    const disposeTools = registerGlobalTools();
    assistant.open = bootstrap?.surface === 'floating';
    void begin();
    const change = (event: Event) => {
      sandboxMounted = (event as CustomEvent<string>).detail === 'sandbox';
    };
    window.addEventListener('fixture:eval-page', change);
    return () => {
      window.removeEventListener('fixture:eval-page', change);
      disposeTools();
      stop();
    };
  });
</script>

<Shell>
  {#if bootstrap?.surface === 'floating'}
    {#if sandboxMounted}<Sandbox data={sandboxData} />{/if}
    <Floating />
  {:else}
    {#if sandboxMounted}<div hidden><Sandbox data={sandboxData} /></div>{/if}
    <Home {data} />
  {/if}
</Shell>
