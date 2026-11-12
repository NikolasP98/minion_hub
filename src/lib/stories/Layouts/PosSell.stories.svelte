<script module lang="ts">
  // /pos/sell: the real POS module layout (section nav + shift banner) and till body.
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AppShell from './_fixtures/AppShell.svelte';
  import ModuleLayout from '../../../routes/(app)/pos/+layout.svelte';
  import PageBody from '../../../routes/(app)/pos/sell/PageBody.svelte';
  import { collapsedRail, pageAt } from './_fixtures/shell';
  import { posLayoutData, posSettings, sellData } from './_fixtures/pos';

  const { Story } = defineMeta({
    title: 'Layouts/POS/Sell',
    tags: ['autodocs'],
    beforeEach: collapsedRail,
    parameters: { layout: 'fullscreen', ...pageAt('/pos/sell', posLayoutData) },
  });
</script>

{#snippet screen()}
  <AppShell>
    <ModuleLayout>
      <PageBody data={sellData} {posSettings} />
    </ModuleLayout>
  </AppShell>
{/snippet}

<Story name="Default">
  {#snippet template()}{@render screen()}{/snippet}
</Story>

<Story name="Default · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template()}{@render screen()}{/snippet}
</Story>
