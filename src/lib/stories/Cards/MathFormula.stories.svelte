<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import MathFormula from '$lib/components/ui/MathFormula.svelte';

  const { Story } = defineMeta({
    title: 'Atoms/Display/MathFormula',
    component: MathFormula,
    tags: ['autodocs'],
    argTypes: { displayMode: { control: 'boolean' }, tex: { control: 'text' } },
    args: {
      tex: '\\text{margin} = \\frac{\\text{price} - \\text{cost}}{\\text{price}}',
      displayMode: false,
    },
  });
</script>

<Story name="Inline">
  {#snippet template(args)}<div class="w-80 text-foreground">
      <MathFormula {...args} />
    </div>{/snippet}
</Story>

<Story name="Display mode" args={{ displayMode: true }}>
  {#snippet template(args)}<div class="w-80 text-foreground">
      <MathFormula {...args} />
    </div>{/snippet}
</Story>

<Story name="Substituted values" args={{ tex: '\\frac{1{,}200 - 350}{1{,}200} = 0.708' }}>
  {#snippet template(args)}<div class="w-80 text-foreground">
      <MathFormula {...args} />
    </div>{/snippet}
</Story>

<Story
  name="Long (auto-fit to width)"
  args={{
    tex: '\\sum_{i=1}^{n} \\left( \\text{qty}_i \\times \\text{price}_i - \\text{discount}_i \\right) \\times (1 + \\text{igv}) - \\text{deposit} + \\text{tip} - \\text{refund}_{\\text{partial}}',
  }}
>
  {#snippet template(args)}<div class="w-48 border border-border text-foreground">
      <MathFormula {...args} />
    </div>{/snippet}
</Story>

<Story name="Invalid TeX (falls back)" args={{ tex: '\\frac{unclosed' }}>
  {#snippet template(args)}<div class="w-80 text-foreground">
      <MathFormula {...args} />
    </div>{/snippet}
</Story>

<Story name="Empty" args={{ tex: '' }}>
  {#snippet template(args)}<div class="w-80 border border-border text-foreground">
      <MathFormula {...args} />
    </div>{/snippet}
</Story>
