<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import DataView, { type DataViewKind } from '$lib/components/data-view/DataView.svelte';

  const { Story } = defineMeta({
    title: 'Data/DataView',
    component: DataView,
    tags: ['autodocs'],
    argTypes: { value: { control: 'select', options: ['calendar', 'table', 'board', 'gallery'] } },
    args: { views: ['table', 'board', 'calendar', 'gallery'], value: 'table', onchange: fn() },
  });
</script>

<script lang="ts">
  let active = $state<DataViewKind>('board');
</script>

<Story name="AllViews">
  {#snippet template(args)}
    <DataView {...args}>
      {#snippet children({ switcher, view })}
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-medium">Bookings</h2>
          {@render switcher()}
        </div>
        <div class="rounded border border-border p-6 text-sm text-muted-foreground">
          Active view: <strong>{view}</strong>
        </div>
      {/snippet}
    </DataView>
  {/snippet}
</Story>

<Story name="TwoViews" args={{ views: ['table', 'board'], value: 'board' }}>
  {#snippet template(args)}
    <DataView {...args}>
      {#snippet children({ switcher, view })}
        {@render switcher()}
        <p class="mt-3 text-sm text-muted-foreground">Active view: {view}</p>
      {/snippet}
    </DataView>
  {/snippet}
</Story>

<Story name="SingleViewNoSwitcher" args={{ views: ['table'], value: 'table' }}>
  {#snippet template(args)}
    <DataView {...args}>
      {#snippet children({ switcher, view })}
        {@render switcher()}
        <p class="text-sm text-muted-foreground">One view = no switcher rendered. Active: {view}</p>
      {/snippet}
    </DataView>
  {/snippet}
</Story>

<Story name="Interactive">
  {#snippet template(args)}
    <DataView {...args} value={active} onchange={(v) => (active = v)}>
      {#snippet children({ switcher, view })}
        {@render switcher()}
        <p class="mt-3 text-sm text-muted-foreground">Active view: {view}</p>
      {/snippet}
    </DataView>
  {/snippet}
</Story>
