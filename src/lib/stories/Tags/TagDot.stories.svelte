<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import TagDot from '$lib/components/tags/TagDot.svelte';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';

  const { Story } = defineMeta({
    title: 'Tags/TagDot',
    component: TagDot,
    tags: ['autodocs'],
    argTypes: {
      origin: {
        control: 'select',
        options: [undefined, 'own', 'contact', 'product', 'ingredient'],
      },
    },
    args: { name: 'VIP', color: CRM_TAG_COLORS[0] },
  });
</script>

<Story name="Default">
  {#snippet template(args)}<TagDot {...args} />{/snippet}
</Story>

<Story name="All colours">
  {#snippet template(args)}
    <div class="flex items-center gap-1 p-2 bg-surface-1">
      {#each CRM_TAG_COLORS as color (color)}<TagDot {...args} name={color} {color} />{/each}
      <TagDot {...args} name="accent" color={null} />
    </div>
  {/snippet}
</Story>

<Story name="Origins (shapes)">
  {#snippet template(args)}
    <div class="flex items-center gap-2 p-2 bg-surface-1">
      {#each ['own', 'contact', 'product', 'ingredient'] as origin (origin)}<TagDot
          {...args}
          name={origin}
          {origin}
        />{/each}
    </div>
  {/snippet}
</Story>

<Story name="Twenty in a dense row">
  {#snippet template(args)}
    <div class="w-24 flex items-center gap-0.5 flex-wrap p-1 bg-surface-1">
      {#each Array.from({ length: 20 }, (_, i) => i) as i (i)}<TagDot
          {...args}
          name={`tag ${i + 1}`}
          color={CRM_TAG_COLORS[i % CRM_TAG_COLORS.length]}
        />{/each}
    </div>
  {/snippet}
</Story>

<Story
  name="Long name (title)"
  args={{
    name: 'Pacientes con tratamiento combinado de larga duración y seguimiento trimestral',
    origin: 'contact',
  }}
>
  {#snippet template(args)}<TagDot {...args} />{/snippet}
</Story>
