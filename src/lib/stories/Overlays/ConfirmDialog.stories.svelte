<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ConfirmDialog from '$lib/components/ui/foundations/ConfirmDialog.svelte';
  import { Button } from '$lib/components/ui';

  // A confirmation is an alert dialog: described by its message, first focus on Cancel.
  const { Story } = defineMeta({
    title: 'Atoms/Overlays/ConfirmDialog',
    component: ConfirmDialog,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '360px' } } },
  });
</script>

<script lang="ts">
  let open = $state(false);
  let confirmed = $state(0);
</script>

<Story name="Open">
  {#snippet template()}
    <ConfirmDialog
      open
      title="Delete record"
      message="Delete Alpha? This cannot be undone."
      confirmLabel="Delete"
      failureMessage="Could not delete"
      tone="danger"
      onconfirm={() => {}}
    />
  {/snippet}
</Story>

<Story name="Trigger">
  {#snippet template()}
    <Button size="sm" onclick={() => (open = true)}>Delete Alpha</Button>
    <p data-last>Confirmed: {confirmed}</p>
    <ConfirmDialog
      bind:open
      title="Delete record"
      message="Delete Alpha? This cannot be undone."
      confirmLabel="Delete"
      failureMessage="Could not delete"
      tone="danger"
      onconfirm={() => void confirmed++}
    />
  {/snippet}
</Story>
