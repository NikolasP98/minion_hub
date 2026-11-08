<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import InlineTagsCell from '$lib/components/tags/InlineTagsCell.svelte';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';

  const names = ['VIP', 'new', 'follow-up', 'allergy', 'no-show risk', 'wholesale', 'student', 'referral', 'promo-2026', 'lapsed'];
  const tags = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: names[i % names.length] + (i >= names.length ? ` ${i}` : ''), color: CRM_TAG_COLORS[i % CRM_TAG_COLORS.length] }));
  const registry = tags(10);

  // Saves PUT `/api/tags/<kind>/<id>`, which fails in Storybook — pick a tag to
  // see the failed/retry state.
  const { Story } = defineMeta({
    title: 'Tags/InlineTagsCell',
    component: InlineTagsCell,
    tags: ['autodocs'],
    argTypes: {
      kind: { control: 'select', options: ['booking', 'event_type', 'product', 'item'] },
      canEdit: { control: 'boolean' },
      showAdd: { control: 'boolean' },
    },
    args: { scope: 'event', kind: 'booking', entityId: 'bk-1', registry, selected: registry.slice(0, 2), onsaved: fn(), onregistrychange: fn() },
  });
</script>

<Story name="Default">
  {#snippet template(args)}<div class="w-80"><InlineTagsCell {...args} /></div>{/snippet}
</Story>

<Story name="Empty" args={{ selected: [] }}>
  {#snippet template(args)}<div class="w-80"><InlineTagsCell {...args} /></div>{/snippet}
</Story>

<Story name="Read-only and inherited tags" args={{ readonly: registry.slice(5, 7), inherited: registry.slice(8, 10) }}>
  {#snippet template(args)}<div class="w-80"><InlineTagsCell {...args} /></div>{/snippet}
</Story>

<Story name="Cannot edit" args={{ canEdit: false, readonly: registry.slice(5, 6) }}>
  {#snippet template(args)}<div class="w-80"><InlineTagsCell {...args} /></div>{/snippet}
</Story>

<Story name="Table mode (picker open)" args={{ showAdd: false, open: true, onOpenChange: fn() }}>
  {#snippet template(args)}<div class="w-80"><InlineTagsCell {...args} /></div>{/snippet}
</Story>

<Story name="Table mode (closed)" args={{ showAdd: false, onOpenChange: fn() }}>
  {#snippet template(args)}<div class="w-80"><InlineTagsCell {...args} /></div>{/snippet}
</Story>

<Story name="Twenty selected" args={{ registry: tags(20), selected: tags(20) }}>
  {#snippet template(args)}<div class="w-80 border border-border"><InlineTagsCell {...args} /></div>{/snippet}
</Story>

<Story name="Product scope" args={{ scope: 'catalog', kind: 'product', entityId: 'p-1' }}>
  {#snippet template(args)}<div class="w-80"><InlineTagsCell {...args} /></div>{/snippet}
</Story>
