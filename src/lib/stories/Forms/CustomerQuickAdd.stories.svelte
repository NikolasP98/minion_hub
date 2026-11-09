<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import CustomerQuickAdd from '$lib/components/pos/CustomerQuickAdd.svelte';

  // Submitting POSTs to `/api/crm/...`, which fails in Storybook and shows the inline error.
  const { Story } = defineMeta({
    title: 'Forms/CustomerQuickAdd',
    component: CustomerQuickAdd,
    tags: ['autodocs'],
    argTypes: { initialQuery: { control: 'text' } },
    args: { oncreated: fn(), oncancel: fn(), initialQuery: '' },
  });
</script>

<Story name="Blank">
  {#snippet template(args)}<div class="w-96"><CustomerQuickAdd {...args} /></div>{/snippet}
</Story>

<Story name="Seeded with a name" args={{ initialQuery: 'Lucía Fernández' }}>
  {#snippet template(args)}<div class="w-96"><CustomerQuickAdd {...args} /></div>{/snippet}
</Story>

<Story name="Seeded with a DNI (person, lookup enabled)" args={{ initialQuery: '12345678' }}>
  {#snippet template(args)}<div class="w-96"><CustomerQuickAdd {...args} /></div>{/snippet}
</Story>

<Story name="Seeded with a RUC (company)" args={{ initialQuery: '20123456789' }}>
  {#snippet template(args)}<div class="w-96"><CustomerQuickAdd {...args} /></div>{/snippet}
</Story>

<Story
  name="Narrow host"
  args={{ initialQuery: 'Maximiliano Alejandro de la Cruz Villanueva-Echeverría' }}
>
  {#snippet template(args)}<div class="w-64 border border-border">
      <CustomerQuickAdd {...args} />
    </div>{/snippet}
</Story>
