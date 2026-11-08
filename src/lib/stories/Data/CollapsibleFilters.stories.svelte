<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import CollapsibleFilters from '$lib/components/data-table/CollapsibleFilters.svelte';
  import { Button } from '$lib/components/ui';

  const { Story } = defineMeta({
    title: 'Data/CollapsibleFilters',
    component: CollapsibleFilters,
    tags: ['autodocs'],
    argTypes: { activeCount: { control: 'number' } },
    args: { activeCount: 0 },
  });
</script>

{#snippet controls()}
  <span data-filter="staff"><Button variant="ghost" size="sm">Staff</Button></span>
  <span data-filter="kind"><Button variant="ghost" size="sm">Kind</Button></span>
  <span data-filter="status"><Button variant="ghost" size="sm">Status</Button></span>
  <span data-filter="date"><Button variant="ghost" size="sm">Date range</Button></span>
{/snippet}

<Story name="Inline">
  {#snippet template(args)}
    <CollapsibleFilters {...args} children={controls} />
  {/snippet}
</Story>

<Story name="ActiveCount" args={{ activeCount: 3 }}>
  {#snippet template(args)}
    <CollapsibleFilters {...args} children={controls} />
  {/snippet}
</Story>

<Story name="Collapsed" args={{ activeCount: 2 }} globals={{ viewport: { value: 'phone' } }}>
  {#snippet template(args)}
    <p class="text-xs text-muted-foreground mb-2">Below 768px the controls collapse into one Filters button.</p>
    <CollapsibleFilters {...args} children={controls} />
  {/snippet}
</Story>
