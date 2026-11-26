<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte';
  import DraggableWindow from './DraggableWindow.svelte';
  import NavigationGuardModal from '$lib/components/config/NavigationGuardModal.svelte';
  // One opener button per overlay, so focus return can be asserted.
  let {
    kind,
    oncancel = () => {},
  }: { kind: 'confirm' | 'guard' | 'window'; oncancel?: () => void } = $props();
  let open = $state(false);
</script>

<button type="button" data-opener onclick={() => (open = true)}>Open</button>
{#if kind === 'confirm'}
  <ConfirmDialog
    bind:open
    title="Delete record"
    message="Delete Alpha? This cannot be undone."
    confirmLabel="Delete"
    failureMessage="Could not delete"
    tone="danger"
    onconfirm={() => {}}
  />
{:else if kind === 'guard'}
  <NavigationGuardModal
    bind:open
    onsave={() => (open = false)}
    ondiscard={() => (open = false)}
    oncancel={() => {
      open = false;
      oncancel();
    }}
  />
{:else}
  <DraggableWindow
    {open}
    title="Agent trace"
    keyboardInstructions="Use Alt plus arrow keys to move this window."
    resizeLabel="Resize agent trace"
    onclose={() => (open = false)}
  >
    <p>Trace body</p>
  </DraggableWindow>
{/if}
