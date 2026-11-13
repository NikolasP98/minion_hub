<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AiOrb from '$lib/components/ai/AiOrb.svelte';
  import { orbPalette, type OrbPalette } from '$lib/components/ai/orb-color';
  import { ACCENT_OPTIONS } from '$lib/themes/presets';
  const accent = (id: string) => {
    const option = ACCENT_OPTIONS.find((a) => a.id === id);
    if (!option) throw new Error(`Unknown accent ${id}`);
    return option.value;
  };

  // The orb fills its parent; the palette is what AiOrbFace derives from the accent.
  const blue = orbPalette(accent('blue'));
  const violet = orbPalette(accent('purple'));
  const green = orbPalette(accent('green'));
  const palette = (p: OrbPalette) => ({ stops: p.stops, body: p.body, edge: p.edge });

  const { Story } = defineMeta({
    title: 'Components/AI/AiOrb',
    component: AiOrb,
    tags: ['autodocs'],
    argTypes: {
      flow: { control: { type: 'range', min: 0, max: 3, step: 0.05 } },
      turbulence: { control: { type: 'range', min: 0, max: 3, step: 0.05 } },
    },
    args: palette(blue),
  });
</script>

<Story name="Default 128 px">
  {#snippet template(args)}<div class="h-32 w-32"><AiOrb {...args} /></div>{/snippet}
</Story>

<Story name="Small 32 px">
  {#snippet template(args)}<div class="size-8"><AiOrb {...args} /></div>{/snippet}
</Story>

<Story name="Large 320 px">
  {#snippet template(args)}<div class="h-80 w-80"><AiOrb {...args} /></div>{/snippet}
</Story>

<Story name="Violet palette" args={palette(violet)}>
  {#snippet template(args)}<div class="h-32 w-32"><AiOrb {...args} /></div>{/snippet}
</Story>

<Story name="Green palette" args={palette(green)}>
  {#snippet template(args)}<div class="h-32 w-32"><AiOrb {...args} /></div>{/snippet}
</Story>

<Story name="Still no flow no turbulence" args={{ flow: 0, turbulence: 0 }}>
  {#snippet template(args)}<div class="h-32 w-32"><AiOrb {...args} /></div>{/snippet}
</Story>

<Story name="Stirred high flow turbulence" args={{ flow: 2.5, turbulence: 2.5 }}>
  {#snippet template(args)}<div class="h-32 w-32"><AiOrb {...args} /></div>{/snippet}
</Story>

<Story name="Many orbs context pressure">
  {#snippet template(args)}
    <div class="flex flex-wrap gap-2">
      {#each Array.from({ length: 24 }, (_, i) => i) as i (i)}
        <div class="size-12"><AiOrb {...args} {...palette([blue, violet, green][i % 3])} /></div>
      {/each}
    </div>
  {/snippet}
</Story>
