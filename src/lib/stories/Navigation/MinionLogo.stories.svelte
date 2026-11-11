<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { ComponentProps } from 'svelte';
  import MinionLogo from '$lib/components/layout/MinionLogo.svelte';
  import { LOGO_PRESETS } from '$lib/state/ui/logo.svelte';

  const sizes: NonNullable<ComponentProps<typeof MinionLogo>['size']>[] = ['sm', 'md', 'lg'];

  const { Story } = defineMeta({
    title: 'Components/Navigation/MinionLogo',
    component: MinionLogo,
    tags: ['autodocs'],
    argTypes: {
      size: { control: 'select', options: ['sm', 'md', 'lg'] },
      showText: { control: 'boolean' },
      compact: { control: 'boolean' },
      preset: { control: 'select', options: LOGO_PRESETS.map((p) => p.id) },
    },
    args: { size: 'md', showText: false, compact: false },
  });
</script>

<Story name="Mark only">
  {#snippet template(args)}<MinionLogo {...args} />{/snippet}
</Story>

<Story name="With text" args={{ showText: true }}>
  {#snippet template(args)}<MinionLogo {...args} />{/snippet}
</Story>

<Story name="Compact" args={{ compact: true, showText: true }}>
  {#snippet template(args)}<MinionLogo {...args} />{/snippet}
</Story>

<Story name="Sizes">
  {#snippet template()}
    <div class="flex items-end gap-6">
      {#each sizes as s (s)}
        <MinionLogo size={s} showText />
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="All presets">
  {#snippet template()}
    <div class="grid grid-cols-3 gap-4">
      {#each LOGO_PRESETS as p (p.id)}
        <div class="surface-2 rounded-[var(--radius-md)] p-3 flex flex-col items-center gap-2">
          <MinionLogo preset={p.id} size="lg" />
          <span class="text-xs text-muted-foreground">{p.id}</span>
        </div>
      {/each}
    </div>
  {/snippet}
</Story>
