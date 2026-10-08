<script lang="ts">
  /** Test-only harness for Dialog's dirty/discard guard (HC-overlay-dirty-guard). */
  import Dialog from './Dialog.svelte';
  import type { DialogCloseReason } from './Dialog.svelte';

  interface Props {
    open?: boolean;
    dirty?: boolean;
    onclose?: (reason: DialogCloseReason) => void;
  }

  let { open = $bindable(true), dirty = false, onclose }: Props = $props();
  let text = $state('');
  let query = $state('');
</script>

<Dialog bind:open title="Harness" {dirty} {onclose}>
  <input class="text-field" bind:value={text} />
  <input class="search-field" type="search" bind:value={query} />
</Dialog>
