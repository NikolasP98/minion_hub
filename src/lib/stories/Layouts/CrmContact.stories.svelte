<script module lang="ts">
  // /crm/[contactId]: the real CRM module layout and record page for one dummy contact.
  // TODO(handoff): ContactChat opens a Supabase realtime channel; without PUBLIC_SUPABASE_* in
  // Storybook it throws inside an $effect (page still renders). Needs a realtime seam or a
  // Storybook-only env stub; see meta spec 2026-11-10-hub-storybook-layers-layouts §Open ends.
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AppShell from './_fixtures/AppShell.svelte';
  import ModuleLayout from '../../../routes/(app)/crm/+layout.svelte';
  import PageBody from '../../../routes/(app)/crm/[contactId]/PageBody.svelte';
  import { collapsedRail, pageAt } from './_fixtures/shell';
  import { contactData, contactId } from './_fixtures/crm-contact';

  const { Story } = defineMeta({
    title: 'Layouts/CRM/Contact',
    tags: ['autodocs'],
    beforeEach: collapsedRail,
    parameters: { layout: 'fullscreen', ...pageAt(`/crm/${contactId}`) },
  });
</script>

{#snippet screen()}
  <AppShell>
    <ModuleLayout>
      <PageBody data={contactData} />
    </ModuleLayout>
  </AppShell>
{/snippet}

<Story name="Default">
  {#snippet template()}{@render screen()}{/snippet}
</Story>

<Story name="Default · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template()}{@render screen()}{/snippet}
</Story>
