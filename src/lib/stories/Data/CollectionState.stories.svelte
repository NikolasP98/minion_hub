<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import CollectionState from '$lib/components/data-view/CollectionState.svelte';
  import { Button } from '@minion-stack/ui';

  const { Story } = defineMeta({
    title: 'Components/Data/CollectionState',
    component: CollectionState,
    tags: ['autodocs'],
    argTypes: {
      state: {
        control: 'select',
        options: ['initial-load', 'refreshing', 'stale', 'empty', 'no-results', 'denied', 'partial', 'failed', 'recovered'],
      },
      view: { control: 'select', options: ['table', 'board', 'calendar', 'gallery'] },
    },
    args: { state: 'initial-load', view: 'table', onRetry: fn() },
  });
</script>

{#snippet createAction()}
  <Button size="sm" onclick={fn()}>New booking</Button>
{/snippet}

{#snippet clearFilters()}
  <Button size="sm" variant="secondary" onclick={fn()}>Clear filters</Button>
{/snippet}

<Story name="InitialLoadTable">
  {#snippet template(args)}
    <CollectionState {...args} />
  {/snippet}
</Story>

<Story name="InitialLoadBoard" args={{ view: 'board' }}>
  {#snippet template(args)}
    <CollectionState {...args} />
  {/snippet}
</Story>

<Story name="InitialLoadCalendar" args={{ view: 'calendar' }}>
  {#snippet template(args)}
    <CollectionState {...args} />
  {/snippet}
</Story>

<Story name="Refreshing" args={{ state: 'refreshing' }}>
  {#snippet template(args)}
    <CollectionState {...args} />
  {/snippet}
</Story>

<Story name="Stale" args={{ state: 'stale', message: 'Last updated 4 minutes ago' }}>
  {#snippet template(args)}
    <CollectionState {...args} />
  {/snippet}
</Story>

<Story name="Empty" args={{ state: 'empty', message: 'Bookings appear here once a client books or you create one.' }}>
  {#snippet template(args)}
    <CollectionState {...args} {createAction} />
  {/snippet}
</Story>

<Story name="NoResults" args={{ state: 'no-results' }}>
  {#snippet template(args)}
    <CollectionState {...args} {clearFilters} />
  {/snippet}
</Story>

<Story name="Denied" args={{ state: 'denied', message: 'Scheduling' }}>
  {#snippet template(args)}
    <CollectionState {...args} />
  {/snippet}
</Story>

<Story name="Partial" args={{ state: 'partial', message: 'Custom columns could not be loaded' }}>
  {#snippet template(args)}
    <CollectionState {...args} />
  {/snippet}
</Story>

<Story name="Failed" args={{ state: 'failed', message: 'The server did not answer within 15 seconds.' }}>
  {#snippet template(args)}
    <CollectionState {...args} />
  {/snippet}
</Story>

<Story name="Recovered" args={{ state: 'recovered' }}>
  {#snippet template(args)}
    <CollectionState {...args} />
  {/snippet}
</Story>
