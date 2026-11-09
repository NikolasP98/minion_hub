<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Sparkline from '$lib/components/charts/Sparkline.svelte';

  const bins = [3, 5, 2, 8, 6, 9, 4, 7, 12, 10, 6, 3, 5, 8, 11, 9, 4, 2, 6, 7, 10, 13, 9, 5];
  // Token-sourced series colours (the agent sidebar's rotation).
  const colors = [
    'var(--color-accent)',
    'var(--color-success-fg)',
    'var(--color-purple)',
    'var(--color-pink)',
    'var(--color-cyan)',
    'var(--color-warning)',
    'var(--color-destructive)',
  ];

  const { Story } = defineMeta({
    title: 'Charts/Sparkline',
    component: Sparkline,
    tags: ['autodocs'],
    argTypes: { glow: { control: 'boolean' }, color: { control: 'text' } },
    args: { bins, glow: false },
  });
</script>

<Story name="Default">
  {#snippet template(args)}<div class="w-64"><Sparkline {...args} /></div>{/snippet}
</Story>

<Story name="Glow" args={{ glow: true }}>
  {#snippet template(args)}<div class="w-64"><Sparkline {...args} /></div>{/snippet}
</Story>

<Story name="Wide">
  {#snippet template(args)}<div class="w-full"><Sparkline {...args} /></div>{/snippet}
</Story>

<Story name="Empty" args={{ bins: [] }}>
  {#snippet template(args)}<div class="w-64"><Sparkline {...args} /></div>{/snippet}
</Story>

<Story name="Flat (all zero)" args={{ bins: Array(24).fill(0) }}>
  {#snippet template(args)}<div class="w-64"><Sparkline {...args} /></div>{/snippet}
</Story>

<Story name="Single point" args={{ bins: [7] }}>
  {#snippet template(args)}<div class="w-64"><Sparkline {...args} /></div>{/snippet}
</Story>

<Story name="Two points" args={{ bins: [2, 9] }}>
  {#snippet template(args)}<div class="w-64"><Sparkline {...args} /></div>{/snippet}
</Story>

<Story name="Spike (large values)" args={{ bins: [1, 1, 2, 1, 1e9, 1, 2, 1, 1] }}>
  {#snippet template(args)}<div class="w-64"><Sparkline {...args} /></div>{/snippet}
</Story>

<Story
  name="Dense (144 bins)"
  args={{
    bins: Array.from({ length: 144 }, (_, i) =>
      Math.max(0, Math.round(Math.sin(i / 6) * 7 + Math.sin(i / 2) * 3 + 6)),
    ),
  }}
>
  {#snippet template(args)}<div class="w-full"><Sparkline {...args} /></div>{/snippet}
</Story>

<Story name="Colours">
  {#snippet template(args)}
    <div class="flex flex-col gap-2 w-64">
      {#each colors as color (color)}<Sparkline {...args} {color} />{/each}
    </div>
  {/snippet}
</Story>
