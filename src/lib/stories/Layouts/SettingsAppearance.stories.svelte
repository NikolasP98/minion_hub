<script module lang="ts">
  // /settings/appearance: the real settings layout and page inside the app shell.
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AppShell from './_fixtures/AppShell.svelte';
  import ModuleLayout from '../../../routes/(app)/settings/+layout.svelte';
  import Page from '../../../routes/(app)/settings/appearance/+page.svelte';
  import { collapsedRail, pageAt } from './_fixtures/shell';

  const { Story } = defineMeta({
    title: 'Layouts/Settings/Appearance',
    tags: ['autodocs'],
    beforeEach: collapsedRail,
    parameters: { layout: 'fullscreen', ...pageAt('/settings/appearance') },
  });
</script>

{#snippet screen()}
  <AppShell>
    <ModuleLayout>
      <Page />
    </ModuleLayout>
  </AppShell>
{/snippet}

<Story name="Default">
  {#snippet template()}{@render screen()}{/snippet}
</Story>

<Story name="Default · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template()}{@render screen()}{/snippet}
</Story>
