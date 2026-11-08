<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EChartsSparkline from '$lib/components/charts/EChartsSparkline.svelte';
  import { ACCENT_OPTIONS } from '$lib/themes/presets';

  // The component appends a hex alpha to `color`, so it needs the resolved
  // accent hex (what the settings preview passes), not a CSS variable.
  const accent = ACCENT_OPTIONS[0].value;
  const bins = Array.from({ length: 144 }, (_, i) => {
    const t = i / 143;
    return Math.max(0, Math.round(Math.sin(t * Math.PI * 4 + 1) * 7 + Math.sin(t * Math.PI * 9) * 3 + 4));
  });

  const { Story } = defineMeta({
    title: 'Charts/EChartsSparkline',
    component: EChartsSparkline,
    tags: ['autodocs'],
    argTypes: {
      chartStyle: { control: 'select', options: ['area', 'bar', 'stepped'] },
      glow: { control: 'boolean' },
    },
    args: { bins, color: accent, glow: false, chartStyle: 'area' },
  });
</script>

<Story name="Area">
  {#snippet template(args)}<div class="w-64"><EChartsSparkline {...args} /></div>{/snippet}
</Story>

<Story name="Bar" args={{ chartStyle: 'bar' }}>
  {#snippet template(args)}<div class="w-64"><EChartsSparkline {...args} /></div>{/snippet}
</Story>

<Story name="Stepped" args={{ chartStyle: 'stepped' }}>
  {#snippet template(args)}<div class="w-64"><EChartsSparkline {...args} /></div>{/snippet}
</Story>

<Story name="Glow" args={{ glow: true }}>
  {#snippet template(args)}<div class="w-64"><EChartsSparkline {...args} /></div>{/snippet}
</Story>

<Story name="Empty" args={{ bins: [] }}>
  {#snippet template(args)}<div class="w-64"><EChartsSparkline {...args} /></div>{/snippet}
</Story>

<Story name="Single point" args={{ bins: [5] }}>
  {#snippet template(args)}<div class="w-64"><EChartsSparkline {...args} /></div>{/snippet}
</Story>

<Story name="Large values" args={{ bins: [1, 4, 2, 1e9, 3, 2, 5e8, 1] }}>
  {#snippet template(args)}<div class="w-64"><EChartsSparkline {...args} /></div>{/snippet}
</Story>

<Story name="All accents">
  {#snippet template(args)}
    <div class="flex flex-col gap-2 w-64">
      {#each ACCENT_OPTIONS as opt (opt.id)}<EChartsSparkline {...args} color={opt.value} />{/each}
    </div>
  {/snippet}
</Story>
