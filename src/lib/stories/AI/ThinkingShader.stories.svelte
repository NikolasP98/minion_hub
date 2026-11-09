<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  // Canvas edge in px, not an icon size.
  const SHADER_PX = 48;
  import ThinkingShader from '$lib/components/assistant/ThinkingShader.svelte';
  import { THINKING_STYLES } from '$lib/components/assistant/thinking-shader';

  // `style` pins a material; without it the shader follows the user's saved preference.
  const { Story } = defineMeta({
    title: 'AI/ThinkingShader',
    component: ThinkingShader,
    tags: ['autodocs'],
    argTypes: {
      style: { control: 'select', options: THINKING_STYLES },
      size: { control: { type: 'range', min: 12, max: 160, step: 4 } },
    },
    args: { size: 20 },
  });
</script>

<Story name="User preference no style" />
<Story name="Large 96 px" args={{ size: 96 }} />

<Story name="All styles">
  {#snippet template(args)}
    <div class="flex flex-wrap items-end gap-6">
      {#each THINKING_STYLES as style (style)}
        <div class="flex flex-col items-center gap-2">
          <ThinkingShader {...args} {style} size={SHADER_PX} />
          <span class="t-caption text-muted-foreground">{style}</span>
        </div>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Sizes 12 to 128">
  {#snippet template(args)}
    <div class="flex items-end gap-4">
      {#each [12, 16, 20, 32, 64, 128] as size (size)}
        <ThinkingShader {...args} {size} />
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Inline with text">
  {#snippet template(args)}
    <p class="flex items-center gap-2 t-body text-muted-foreground"><ThinkingShader {...args} /> Thinking…</p>
  {/snippet}
</Story>
