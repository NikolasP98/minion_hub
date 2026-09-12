<script lang="ts">
  import { pluginNavState } from '$lib/state/plugin-nav.svelte';
  pluginNavState.controlCenters = [
    {
      pluginId: 'studio',
      slot: 'plugins.controlCenter',
      title: 'Fixture Studio',
      description: '',
      entrypoint: 'fixture.html',
      category: 'creative',
    },
  ];
  pluginNavState.enabledByPluginId = { studio: true };
  import Topbar from '$lib/components/layout/Topbar.svelte';
  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import { Button } from '$lib/components/ui';
  import { onMount } from 'svelte';
  let clicks = $state(0);
  onMount(() => {
    const navigation = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest('a[href]');
      if (anchor) event.preventDefault(); // Preserve the real click/close behavior without navigating away.
    };
    document.addEventListener('click', navigation);
    return () => document.removeEventListener('click', navigation);
  });
</script>

<div class="navigation-fixture">
  <Topbar />
  <div class="navigation-body">
    <Sidebar />
    <main>
      <h1>Navigation fixture</h1>
      <Button id="fixture-background" onclick={() => (clicks += 1)}>Background action</Button
      ><output>{clicks}</output>
    </main>
  </div>
</div>

<style>
  .navigation-fixture {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .navigation-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  main {
    flex: 1;
    min-width: 0;
    padding: var(--space-4);
  }
</style>
