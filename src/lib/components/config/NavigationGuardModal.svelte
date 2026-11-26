<script lang="ts">
  /**
   * "You have unsaved changes" prompt shown when leaving Settings with edits. It
   * renders through the shared Dialog as an alertdialog: modal, named, described,
   * Escape and the backdrop cancel, focus starts on Cancel and returns to the page.
   */
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';

  let {
    open = $bindable(false),
    onsave,
    ondiscard,
    oncancel,
  }: {
    open: boolean;
    onsave: () => void;
    ondiscard: () => void;
    oncancel: () => void;
  } = $props();

  const uid = $props.id();
  const messageId = `${uid}-message`;
</script>

<!-- guardDismiss off: this IS the discard prompt; a second "discard changes?" would loop. -->
<Dialog
  bind:open
  title={m.saveBar_unsaved()}
  role="alertdialog"
  describedBy={messageId}
  initialFocus=".nav-guard-cancel"
  size="sm"
  hideClose
  guardDismiss={false}
  onclose={(reason) => reason !== 'programmatic' && oncancel()}
>
  <p id={messageId} class="nav-guard-message">{m.config_unsavedChangesPrompt()}</p>
  {#snippet footer()}
    <Button variant="secondary" size="sm" class="nav-guard-cancel" onclick={oncancel}>
      {m.common_cancel()}
    </Button>
    <Button variant="danger" size="sm" onclick={ondiscard}>
      {m.saveBar_discard()}
    </Button>
    <Button variant="primary" size="sm" onclick={onsave}>
      {m.config_saveAndLeave()}
    </Button>
  {/snippet}
</Dialog>

<style>
  .nav-guard-message {
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
  }
</style>
