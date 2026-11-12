<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import TagFilter from '$lib/components/tags/TagFilter.svelte';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';

  const names = [
    'VIP',
    'new',
    'follow-up',
    'allergy',
    'no-show risk',
    'wholesale',
    'student',
    'referral',
    'promo-2026',
    'lapsed',
  ];
  const tags = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      name: names[i % names.length] + (i >= names.length ? ` ${i}` : ''),
      color: CRM_TAG_COLORS[i % CRM_TAG_COLORS.length],
    }));

  // The popover's open state is internal: click the trigger to see the list.
  const { Story } = defineMeta({
    title: 'Components/Tags/TagFilter',
    component: TagFilter,
    tags: ['autodocs'],
    argTypes: {
      scope: { control: 'select', options: ['crm', 'stock', 'catalog', 'event'] },
      label: { control: 'text' },
    },
    args: {
      scope: 'event',
      tags: tags(6),
      selected: new Set<string>(),
      onselect: fn(),
      ontagschange: fn(),
    },
  });
</script>

<Story name="Default (trigger)">
  {#snippet template(args)}<TagFilter {...args} />{/snippet}
</Story>

<Story name="Active (2 selected)" args={{ selected: new Set(['t0', 't3']) }}>
  {#snippet template(args)}<TagFilter {...args} />{/snippet}
</Story>

<Story name="Custom label" args={{ label: 'Patient tags' }}>
  {#snippet template(args)}<TagFilter {...args} />{/snippet}
</Story>

<Story name="No tags" args={{ tags: [] }}>
  {#snippet template(args)}<TagFilter {...args} />{/snippet}
</Story>

<Story name="Twenty tags" args={{ tags: tags(20), selected: new Set(['t1', 't5', 't9', 't15']) }}>
  {#snippet template(args)}<TagFilter {...args} />{/snippet}
</Story>

<Story name="In a toolbar">
  {#snippet template(args)}
    <div class="flex items-center gap-2 p-2 border border-border bg-surface-1">
      <span class="t-caption text-muted-foreground">Calendar</span>
      <span class="ml-auto"><TagFilter {...args} /></span>
    </div>
  {/snippet}
</Story>
