<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import CompanySwitcher from '$lib/components/layout/CompanySwitcher.svelte';

  // Reads page.data.workspaces; a single workspace auto-POSTs /api/workspaces/select
  // on mount, so stories use zero or several.
  const workspaces = [
    { companyId: 'c-1', role: 'owner', name: 'Faces SAC' },
    { companyId: 'c-2', role: 'member', name: 'Norte Barber EIRL' },
    { companyId: 'c-3', role: 'member', name: 'A workspace with a rather long display name' },
  ];
  const data = (ws: typeof workspaces) => ({
    sveltekit_experimental: { state: { page: { data: { workspaces: ws } } } },
  });

  const { Story } = defineMeta({
    title: 'Components/Navigation/CompanySwitcher',
    component: CompanySwitcher,
    tags: ['autodocs'],
    parameters: data(workspaces),
  });
</script>

<Story name="Several workspaces">
  {#snippet template()}<CompanySwitcher />{/snippet}
</Story>

<Story name="No workspaces (renders nothing)" parameters={data([])}>
  {#snippet template()}
    <p class="text-xs text-muted-foreground">Empty list: nothing mounts.</p>
    <CompanySwitcher />
  {/snippet}
</Story>
