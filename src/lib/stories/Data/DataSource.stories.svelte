<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import DataSource from '$lib/components/ui/DataSource.svelte';

  const rows = ['Alpha', 'Beta', 'Gamma'];

  const { Story } = defineMeta({
    title: 'Atoms/Feedback/DataSource',
    component: DataSource<string[]>,
    tags: ['autodocs'],
    argTypes: {
      module: { control: 'select', options: ['overview', 'crm', 'finance', 'sales', 'scheduling', 'support'] },
      compact: { control: 'boolean' },
    },
    args: { value: rows, module: 'pos', compact: false },
  });
</script>

{#snippet body(value: string[])}
  <ul class="list-disc pl-5 text-sm">
    {#each value as item (item)}<li>{item}</li>{/each}
  </ul>
{/snippet}

<Story name="Granted">
  {#snippet template(args)}
    <DataSource {...args} children={body} />
  {/snippet}
</Story>

<Story name="Denied" args={{ value: { denied: 'pos', verb: 'view' } }}>
  {#snippet template(args)}
    <DataSource {...args} children={body} />
  {/snippet}
</Story>

<Story name="DeniedModuleFallback" args={{ value: { denied: 'finance', verb: 'view' }, module: 'crm' }}>
  {#snippet template(args)}
    <p class="text-xs text-muted-foreground mb-2">The marker's own module (Finances) wins over the `module` prop (CRM).</p>
    <DataSource {...args} children={body} />
  {/snippet}
</Story>

<Story name="DeniedCompact" args={{ value: { denied: 'scheduling', verb: 'view' }, compact: true }}>
  {#snippet template(args)}
    <DataSource {...args} children={body} />
  {/snippet}
</Story>
