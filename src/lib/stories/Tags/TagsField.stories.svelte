<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import TagsField from '$lib/components/tags/TagsField.svelte';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';

  const names = ['VIP', 'new', 'follow-up', 'allergy', 'no-show risk', 'wholesale', 'student', 'referral', 'promo-2026', 'lapsed'];
  const tags = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: names[i % names.length] + (i >= names.length ? ` ${i}` : ''), color: CRM_TAG_COLORS[i % CRM_TAG_COLORS.length] }));
  const ids = (n) => Array.from({ length: n }, (_, i) => `t${i}`);

  const { Story } = defineMeta({
    title: 'Tags/TagsField',
    component: TagsField,
    tags: ['autodocs'],
    argTypes: {
      scope: { control: 'select', options: ['crm', 'stock', 'catalog', 'event'] },
      disabled: { control: 'boolean' },
      selectionDisabled: { control: 'boolean' },
      showAdd: { control: 'boolean' },
    },
    args: { scope: 'crm', allTags: tags(10), value: [], onchange: fn(), onregistrychange: fn() },
  });
</script>

<Story name="Empty">
  {#snippet template(args)}<div class="w-80"><TagsField {...args} /></div>{/snippet}
</Story>

<Story name="Selected" args={{ value: ids(3) }}>
  {#snippet template(args)}<div class="w-80"><TagsField {...args} /></div>{/snippet}
</Story>

<Story name="Twenty selected (wraps)" args={{ allTags: tags(20), value: ids(20) }}>
  {#snippet template(args)}<div class="w-80 border border-border"><TagsField {...args} /></div>{/snippet}
</Story>

<Story name="Disabled" args={{ value: ids(2), disabled: true }}>
  {#snippet template(args)}<div class="w-80"><TagsField {...args} /></div>{/snippet}
</Story>

<Story name="Selection pending (persisting)" args={{ value: ids(2), selectionDisabled: true }}>
  {#snippet template(args)}<div class="w-80"><TagsField {...args} /></div>{/snippet}
</Story>

<Story name="Table mode (no add, picker open)" args={{ value: ids(2), showAdd: false, open: true }}>
  {#snippet template(args)}<div class="w-80"><TagsField {...args} /></div>{/snippet}
</Story>

<Story name="Table mode (closed)" args={{ value: ids(2), showAdd: false }}>
  {#snippet template(args)}<div class="w-80"><TagsField {...args} /></div>{/snippet}
</Story>

<Story name="Rejected save (rolls back)" args={{ value: ids(1), onchange: () => false }}>
  {#snippet template(args)}<div class="w-80"><TagsField {...args} /></div>{/snippet}
</Story>

<Story name="Slow save" args={{ value: ids(1), onchange: () => new Promise((r) => setTimeout(r, 2500)) }}>
  {#snippet template(args)}<div class="w-80"><TagsField {...args} /></div>{/snippet}
</Story>

<Story name="Stale id (ignored)" args={{ value: ['t0', 'missing'] }}>
  {#snippet template(args)}<div class="w-80"><TagsField {...args} /></div>{/snippet}
</Story>
