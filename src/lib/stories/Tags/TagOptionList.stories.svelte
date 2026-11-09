<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import TagOptionList from '$lib/components/tags/TagOptionList.svelte';
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
  const tag = (i, over = {}) => ({
    id: `t${i}`,
    name: names[i % names.length] + (i >= names.length ? ` ${i}` : ''),
    color: CRM_TAG_COLORS[i % CRM_TAG_COLORS.length],
    ...over,
  });
  const tags = (n) => Array.from({ length: n }, (_, i) => tag(i));

  // Mutations POST/PATCH/DELETE `/api/tags*` — in Storybook those fail and the
  // list shows its inline error, which is itself a state worth seeing.
  const { Story } = defineMeta({
    title: 'Tags/TagOptionList',
    component: TagOptionList,
    tags: ['autodocs'],
    argTypes: {
      scope: { control: 'select', options: ['crm', 'stock', 'catalog', 'event'] },
      allowCreate: { control: 'boolean' },
      allowEdit: { control: 'boolean' },
      disabled: { control: 'boolean' },
    },
    args: {
      scope: 'crm',
      tags: tags(6),
      selected: new Set(),
      ontoggle: fn(),
      oncreate: fn(),
      onupdate: fn(),
      ondelete: fn(),
    },
  });
</script>

<!-- Hover a row for its ⋯ menu (rename / recolour / delete); type a new name for "Create". -->
<Story name="Default">
  {#snippet template(args)}<div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args} />
    </div>{/snippet}
</Story>

<Story name="With selection" args={{ selected: new Set(['t0', 't2', 't4']) }}>
  {#snippet template(args)}<div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args} />
    </div>{/snippet}
</Story>

<Story name="Empty registry" args={{ tags: [] }}>
  {#snippet template(args)}<div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args} />
    </div>{/snippet}
</Story>

<Story name="Twenty tags" args={{ tags: tags(20), selected: new Set(['t1', 't19']) }}>
  {#snippet template(args)}<div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args} />
    </div>{/snippet}
</Story>

<Story name="No create" args={{ allowCreate: false }}>
  {#snippet template(args)}<div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args} />
    </div>{/snippet}
</Story>

<Story name="No edit (toggle only)" args={{ allowEdit: false, allowCreate: false }}>
  {#snippet template(args)}<div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args} />
    </div>{/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true, selected: new Set(['t0']) }}>
  {#snippet template(args)}<div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args} />
    </div>{/snippet}
</Story>

<Story
  name="Foreign-origin tags (event scope)"
  args={{
    scope: 'event',
    tags: [tag(0), tag(1, { origin: 'contact' }), tag(2, { origin: 'product' })],
  }}
>
  {#snippet template(args)}<div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args} />
    </div>{/snippet}
</Story>

<Story name="With header row">
  {#snippet template(args)}
    <div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args}>
        {#snippet header()}<div class="px-2 py-1 t-caption text-muted-foreground">
            All tags
          </div>{/snippet}
      </TagOptionList>
    </div>
  {/snippet}
</Story>

<Story
  name="Long names"
  args={{
    tags: [
      tag(0, {
        name: 'Pacientes con tratamiento combinado de larga duración y seguimiento trimestral',
      }),
      tag(1, { name: 'x'.repeat(60) }),
    ],
  }}
>
  {#snippet template(args)}<div class="w-72 border border-border bg-surface-1">
      <TagOptionList {...args} />
    </div>{/snippet}
</Story>
