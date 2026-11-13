<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import CommandPalette from '$lib/components/layout/CommandPalette.svelte';
  import { Button } from '$lib/components/ui';
  import { palette, togglePalette } from '$lib/state/ui/command-palette.svelte';

  // Commands come from the route registry gated by `canViewPath` (page.data).
  const pageData = {
    user: { id: 'u-1', role: 'admin', email: 'ana@example.com', displayName: 'Ana' },
    permissions: { permissions: ['settings:manage', 'users:manage'], roles: ['owner'] },
    activeOrgKind: 'business',
  };

  const { Story } = defineMeta({
    title: 'Components/Overlays/CommandPalette',
    component: CommandPalette,
    tags: ['autodocs'],
    parameters: {
      docs: { story: { inline: false, height: '480px' } },
      sveltekit_experimental: { state: { page: { data: pageData } } },
    },
  });

  const openWith = (query: string) => async () => {
    palette.open = true;
    palette.query = query;
    palette.selectedIndex = 0;
  };
</script>

<Story name="Open" play={openWith('')}>
  {#snippet template()}<CommandPalette />{/snippet}
</Story>

<Story name="Filtered query" play={openWith('set')}>
  {#snippet template()}<CommandPalette />{/snippet}
</Story>

<Story name="No results" play={openWith('qwxyz')}>
  {#snippet template()}<CommandPalette />{/snippet}
</Story>

<Story name="Trigger (Mod+K)">
  {#snippet template()}
    <Button size="sm" onclick={() => togglePalette()}>Toggle palette</Button>
    <CommandPalette />
  {/snippet}
</Story>

<!-- Responsive: the shortcut hint (kbd) is hidden below sm. -->
<Story
  name="Open · Phone"
  play={openWith('')}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template()}<CommandPalette />{/snippet}
</Story>
