<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';

  /**
   * Guard for the story test lane: stories must be measured with the app's real styles.
   * If the lane loses its CSS producer (Tailwind), the theme variables and utilities vanish,
   * the page turns white and every contrast number is wrong. This story then fails, and a
   * failed story is an unmeasured row in the accessibility gate.
   */
  const { Story } = defineMeta({ title: 'Foundations/Rendering contract' });

  /** A computed colour with no paint: `transparent` or a zero alpha. */
  const clear = (colour: string) => colour === 'transparent' || /,\s*0\)$/.test(colour);

  const rendersLikeTheApp = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const root = getComputedStyle(document.documentElement);
    const probe = canvasElement.querySelector<HTMLElement>('[data-probe]');
    if (!probe) throw new Error('rendering contract: probe not rendered');
    const problems: string[] = [];
    if (!root.getPropertyValue('--color-canvas').trim())
      problems.push('theme variable --color-canvas is empty');
    const page = getComputedStyle(document.body).backgroundColor;
    if (clear(page)) problems.push(`the page has no background (${page})`);
    const style = getComputedStyle(probe);
    if (style.fontWeight !== '600')
      problems.push(`utility font-semibold not applied (${style.fontWeight})`);
    if (style.paddingLeft === '0px') problems.push('utility px-4 not applied');
    if (clear(style.backgroundColor)) problems.push('theme utility bg-bg2 not applied');
    if (problems.length)
      throw new Error(`stories are not rendered with the app's styles: ${problems.join('; ')}`);
  };
</script>

<Story name="Stories use the app's styles" play={rendersLikeTheApp}>
  {#snippet template()}
    <p data-probe class="bg-bg2 px-4 font-semibold text-foreground">
      Stories are measured with the app's real styles.
    </p>
  {/snippet}
</Story>
