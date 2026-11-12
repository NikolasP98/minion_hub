<script module lang="ts">
  // /stock/entries: the real stock module layout and route body inside the app shell.
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AppShell from './_fixtures/AppShell.svelte';
  import ModuleLayout from '../../../routes/(app)/stock/+layout.svelte';
  import PageBody from '../../../routes/(app)/stock/entries/PageBody.svelte';
  import { collapsedRail, pageAt } from './_fixtures/shell';
  import { stockEntriesData } from './_fixtures/stock-entries';

  const { Story } = defineMeta({
    title: 'Layouts/Stock/Entries',
    tags: ['autodocs'],
    beforeEach: collapsedRail,
    parameters: { layout: 'fullscreen', ...pageAt('/stock/entries') },
  });
</script>

{#snippet screen()}
  <AppShell>
    <ModuleLayout>
      <PageBody data={stockEntriesData} />
    </ModuleLayout>
  </AppShell>
{/snippet}

<Story name="Default">
  {#snippet template()}{@render screen()}{/snippet}
</Story>

<Story name="Default · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template()}{@render screen()}{/snippet}
</Story>
