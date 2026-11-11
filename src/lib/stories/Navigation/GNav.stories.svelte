<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import GNav from '$lib/components/layout/GNav.svelte';

  // Renders nothing until `g` is pressed; the chord hint then shows for 1.5s.
  const { Story } = defineMeta({
    title: 'Components/Navigation/GNav',
    component: GNav,
    tags: ['autodocs'],
    parameters: {
      docs: { story: { inline: false, height: '160px' } },
      sveltekit_experimental: {
        state: {
          page: {
            data: {
              user: { id: 'u-1', role: 'admin' },
              permissions: { permissions: ['settings:manage'], roles: ['owner'] },
              activeOrgKind: 'business',
            },
          },
        },
      },
    },
  });
</script>

<Story
  name="Armed (press g)"
  play={async ({ userEvent }) => {
    await userEvent.keyboard('g');
  }}
>
  {#snippet template()}
    <p class="text-sm text-muted-foreground">
      Press <kbd class="px-1 rounded bg-bg3 border border-border font-mono">g</kbd> then a letter.
    </p>
    <GNav />
  {/snippet}
</Story>

<Story name="Idle">
  {#snippet template()}
    <p class="text-sm text-muted-foreground">Nothing rendered until armed.</p>
    <GNav />
  {/snippet}
</Story>

<!-- Responsive: the chord bar is capped to the viewport width minus gutters and scrolls horizontally. -->
<Story
  name="Armed (press g) · Phone"
  play={async ({ userEvent }) => {
    await userEvent.keyboard('g');
  }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template()}
    <p class="text-sm text-muted-foreground">
      Press <kbd class="px-1 rounded bg-bg3 border border-border font-mono">g</kbd> then a letter.
    </p>
    <GNav />
  {/snippet}
</Story>
