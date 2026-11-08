<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { iconSizes } from '$lib/components/ui';
  import { Calendar } from 'lucide-svelte';
  import NavIcon from '$lib/components/layout/NavIcon.svelte';

  const { Story } = defineMeta({
    title: 'Navigation/NavIcon',
    component: NavIcon,
    tags: ['autodocs'],
    argTypes: { size: { control: { type: 'number', min: 12, max: 48 } } },
    args: { icon: Calendar, size: 18 },
  });
</script>

<Story name="Lucide component">
  {#snippet template(args)}<NavIcon {...args} />{/snippet}
</Story>

<Story name="Emoji string" args={{ icon: '🧾' }}>
  {#snippet template(args)}<NavIcon {...args} />{/snippet}
</Story>

<Story name="Brand icon name" args={{ icon: 'telegram' }}>
  {#snippet template(args)}<NavIcon {...args} />{/snippet}
</Story>

<Story name="Unknown name (puzzle fallback)" args={{ icon: 'not-a-real-icon' }}>
  {#snippet template(args)}<NavIcon {...args} />{/snippet}
</Story>

<Story name="Sizes">
  {#snippet template()}
    <div class="flex items-end gap-4 text-foreground">
      {#each [12, 16, 18, 24, 32, 48] as s (s)}
        <NavIcon icon={Calendar} size={s} />
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Brand set">
  {#snippet template()}
    <div class="flex items-center gap-4 text-foreground">
      {#each ['gmail', 'discord', 'telegram', 'whatsapp', 'slack'] as name (name)}
        <NavIcon icon={name} size={iconSizes.lg} />
      {/each}
    </div>
  {/snippet}
</Story>
