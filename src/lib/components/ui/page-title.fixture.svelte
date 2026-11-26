<script lang="ts">
  import { setContext, untrack } from 'svelte';
  import PageHeader from './PageHeader.svelte';
  import PageShell, { MAIN_LANDMARK } from './foundations/PageShell.svelte';
  // `own` = the page sets its own title and therefore opts the header out.
  let { own = false, inShell = false }: { own?: boolean; inShell?: boolean } = $props();
  if (untrack(() => inShell)) setContext(MAIN_LANDMARK, true);
</script>

<svelte:head>
  {#if own}<title>Ana Díaz — CRM</title>{/if}
</svelte:head>

<PageShell archetype="collection">
  <PageHeader title="Developers" documentTitle={!own} />
</PageShell>
