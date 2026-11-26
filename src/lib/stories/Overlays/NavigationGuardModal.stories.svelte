<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import NavigationGuardModal from '$lib/components/config/NavigationGuardModal.svelte';
  import { Button } from '$lib/components/ui';

  // The "You have unsaved changes" prompt shown when leaving Settings with edits.
  const { Story } = defineMeta({
    title: 'Components/Overlays/NavigationGuardModal',
    component: NavigationGuardModal,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '360px' } } },
  });
</script>

<script lang="ts">
  let open = $state(false);
  let last = $state('—');
  const close = (what: string) => () => {
    last = what;
    open = false;
  };
</script>

<Story name="Open">
  {#snippet template()}
    <NavigationGuardModal open onsave={() => {}} ondiscard={() => {}} oncancel={() => {}} />
  {/snippet}
</Story>

<Story name="Trigger">
  {#snippet template()}
    <Button size="sm" onclick={() => (open = true)}>Leave with unsaved changes</Button>
    <p data-last>Last choice: {last}</p>
    <NavigationGuardModal
      bind:open
      onsave={close('save')}
      ondiscard={close('discard')}
      oncancel={close('cancel')}
    />
  {/snippet}
</Story>
