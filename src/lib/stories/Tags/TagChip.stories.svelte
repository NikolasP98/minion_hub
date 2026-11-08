<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { iconSizes } from '$lib/components/ui';
  import { fn } from 'storybook/test';
  import { Star } from 'lucide-svelte';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';

  const names = ['VIP', 'new', 'follow-up', 'allergy', 'no-show risk', 'wholesale', 'student', 'referral', 'promo-2026', 'lapsed'];
  const twenty = Array.from({ length: 20 }, (_, i) => ({ name: `${names[i % names.length]} ${i + 1}`, color: CRM_TAG_COLORS[i % CRM_TAG_COLORS.length] }));

  const { Story } = defineMeta({
    title: 'Tags/TagChip',
    component: TagChip,
    tags: ['autodocs'],
    argTypes: {
      size: { control: 'select', options: ['sm', 'md'] },
      origin: { control: 'select', options: [undefined, 'own', 'contact', 'product', 'ingredient'] },
      dashed: { control: 'boolean' },
    },
    args: { name: 'VIP', color: CRM_TAG_COLORS[0], size: 'md' },
  });
</script>

<Story name="Default">
  {#snippet template(args)}<TagChip {...args} />{/snippet}
</Story>

<Story name="All colours (persisted palette)">
  {#snippet template(args)}
    <div class="flex flex-wrap gap-2">
      {#each CRM_TAG_COLORS as color (color)}<TagChip {...args} name={color} {color} />{/each}
      <TagChip {...args} name="no colour (accent)" color={null} />
    </div>
  {/snippet}
</Story>

<Story name="Small" args={{ size: 'sm' }}>
  {#snippet template(args)}
    <div class="flex flex-wrap gap-2">
      {#each CRM_TAG_COLORS as color (color)}<TagChip {...args} name={color} {color} />{/each}
    </div>
  {/snippet}
</Story>

<Story name="Removable" args={{ onremove: fn() }}>
  {#snippet template(args)}
    <div class="flex gap-2"><TagChip {...args} /><TagChip {...args} size="sm" /></div>
  {/snippet}
</Story>

<Story name="Origins">
  {#snippet template(args)}
    <div class="flex flex-wrap gap-2">
      {#each ['own', 'contact', 'product', 'ingredient'] as origin (origin)}<TagChip {...args} name={origin} {origin} />{/each}
    </div>
  {/snippet}
</Story>

<Story name="Dashed (auto-derived)" args={{ dashed: true, name: 'auto: lapsed 90d' }}>
  {#snippet template(args)}<TagChip {...args} />{/snippet}
</Story>

<Story name="With leading icon">
  {#snippet template(args)}<TagChip {...args}><Star size={iconSizes.xs} /></TagChip>{/snippet}
</Story>

<Story name="Long name (truncates in a narrow host)" args={{ name: 'Pacientes con tratamiento combinado de larga duración y seguimiento trimestral', onremove: fn() }}>
  {#snippet template(args)}<div class="w-48 border border-border"><TagChip {...args} /></div>{/snippet}
</Story>

<Story name="Twenty tags (overflow)">
  {#snippet template(args)}
    <div class="w-80 border border-border flex flex-wrap gap-1 p-2">
      {#each twenty as t (t.name)}<TagChip {...args} name={t.name} color={t.color} />{/each}
    </div>
  {/snippet}
</Story>
