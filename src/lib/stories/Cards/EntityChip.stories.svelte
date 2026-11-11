<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EntityChip from '$lib/components/ui/EntityChip.svelte';
  import { KIND_COLOR, type EntityRef } from '$lib/types/entities';

  const refs: EntityRef[] = [
    {
      kind: 'org',
      id: 'o1',
      label: 'FACES Clinic',
      icon: 'Building2',
      color: KIND_COLOR.org,
      href: '/org',
    },
    {
      kind: 'area',
      id: 'a1',
      label: 'Front desk',
      icon: 'Headphones',
      color: KIND_COLOR.area,
      href: '/areas/a1',
    },
    {
      kind: 'agent',
      id: 'g1',
      label: 'Booking agent',
      icon: 'Bot',
      color: KIND_COLOR.agent,
      href: '/agents/g1',
    },
    {
      kind: 'skill',
      id: 's1',
      label: 'Summarise thread',
      icon: 'Sparkles',
      color: KIND_COLOR.skill,
    },
    { kind: 'tool', id: 't1', label: 'Calendar API', icon: 'Wrench', color: KIND_COLOR.tool },
    {
      kind: 'user',
      id: 'u1',
      label: 'Lucía Fernández',
      icon: 'User',
      color: KIND_COLOR.user,
      href: '/users/u1',
    },
  ];

  const { Story } = defineMeta({
    title: 'Atoms/Display/EntityChip',
    component: EntityChip,
    tags: ['autodocs'],
    argTypes: { size: { control: 'select', options: ['sm', 'md'] }, link: { control: 'boolean' } },
    args: { ref: refs[2], size: 'sm', link: true },
  });
</script>

<Story name="Default">
  {#snippet template(args)}<EntityChip {...args} />{/snippet}
</Story>

<Story name="All kinds">
  {#snippet template(args)}
    <div class="flex flex-wrap gap-2">
      {#each refs as ref (ref.id)}<EntityChip {...args} {ref} />{/each}
    </div>
  {/snippet}
</Story>

<Story name="Medium size" args={{ size: 'md' }}>
  {#snippet template(args)}
    <div class="flex flex-wrap gap-2">
      {#each refs as ref (ref.id)}<EntityChip {...args} {ref} />{/each}
    </div>
  {/snippet}
</Story>

<Story name="Inline in a sentence">
  {#snippet template(args)}
    <p class="text-foreground max-w-md">
      The ticket was routed to <EntityChip {...args} ref={refs[1]} /> and picked up by
      <EntityChip {...args} ref={refs[2]} /> using <EntityChip {...args} ref={refs[3]} />, then
      handed to
      <EntityChip {...args} ref={refs[5]} />.
    </p>
  {/snippet}
</Story>

<Story name="Not a link" args={{ link: false }}>
  {#snippet template(args)}<EntityChip {...args} />{/snippet}
</Story>

<Story
  name="With image"
  args={{ ref: { ...refs[5], imageUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=LF' } }}
>
  {#snippet template(args)}<EntityChip {...args} />{/snippet}
</Story>

<Story
  name="No colour, unknown icon"
  args={{
    ref: { kind: 'tool', id: 'x', label: 'Fallback icon', icon: 'NotARealIcon', color: null },
  }}
>
  {#snippet template(args)}<EntityChip {...args} />{/snippet}
</Story>

<Story
  name="Long label (truncates)"
  args={{
    ref: { ...refs[0], label: 'Clínica de Dermatología Estética y Medicina Regenerativa del Sur' },
  }}
>
  {#snippet template(args)}<EntityChip {...args} />{/snippet}
</Story>
