<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ShortcutsOverlay from '$lib/components/layout/ShortcutsOverlay.svelte';
  import CommandPalette from '$lib/components/layout/CommandPalette.svelte';
  import GNav from '$lib/components/layout/GNav.svelte';

  // No `open` prop: the cheat-sheet toggles on `?`. Live rows come from whatever
  // hotkeys are registered, so the palette + g-nav are mounted alongside.
  const { Story } = defineMeta({
    title: 'Overlays/ShortcutsOverlay',
    component: ShortcutsOverlay,
    tags: ['autodocs'],
    parameters: {
      docs: { story: { inline: false, height: '520px' } },
      sveltekit_experimental: { state: { page: { data: { user: { id: 'u-1', role: 'admin' }, permissions: { permissions: [], roles: ['owner'] }, activeOrgKind: 'business' } } } },
    },
  });

  const pressQuestionMark = async ({ userEvent }) => {
    await userEvent.keyboard('{Shift>}?{/Shift}');
  };
</script>

<Story name="Open (press ?)" play={pressQuestionMark}>
  {#snippet template()}
    <CommandPalette />
    <GNav />
    <ShortcutsOverlay />
  {/snippet}
</Story>

<Story name="Only static grid rows" play={pressQuestionMark}>
  {#snippet template()}
    <ShortcutsOverlay />
  {/snippet}
</Story>

<Story name="Trigger (idle)">
  {#snippet template()}
    <p class="text-sm text-muted-foreground">Press <kbd class="px-1 rounded bg-bg3 border border-border font-mono">?</kbd> to open.</p>
    <ShortcutsOverlay />
  {/snippet}
</Story>

<!-- Responsive: the max-w-lg card becomes full width and caps at 80dvh on a phone. -->
<Story name="Open (press ?) · Phone" play={pressQuestionMark} globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template()}
    <CommandPalette />
    <GNav />
    <ShortcutsOverlay />
  {/snippet}
</Story>
