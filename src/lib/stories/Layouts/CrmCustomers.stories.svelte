<script module lang="ts">
  // /crm/customers: the real CRM module layout and route body inside the app shell.
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AppShell from './_fixtures/AppShell.svelte';
  import ModuleLayout from '../../../routes/(app)/crm/+layout.svelte';
  import PageBody from '../../../routes/(app)/crm/customers/PageBody.svelte';
  import { collapsedRail, pageAt } from './_fixtures/shell';
  import { customersData } from './_fixtures/crm';

  const { Story } = defineMeta({
    title: 'Layouts/CRM/Customers',
    tags: ['autodocs'],
    beforeEach: collapsedRail,
    parameters: { layout: 'fullscreen', ...pageAt('/crm/customers') },
  });
</script>

{#snippet screen()}
  <AppShell>
    <ModuleLayout>
      <PageBody data={customersData} />
    </ModuleLayout>
  </AppShell>
{/snippet}

<Story name="Default">
  {#snippet template()}{@render screen()}{/snippet}
</Story>

<Story name="Default · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template()}{@render screen()}{/snippet}
</Story>
