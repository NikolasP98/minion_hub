<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    type: 'skill' | 'agent' | 'tool';
    name: string;
    onCancel: () => void;
    onConfirm: () => void;
  }

  let { type, name, onCancel, onConfirm }: Props = $props();
</script>

<!-- HC-028: mounted by the parent `{#if deleteTarget}`; the shared native
     <dialog> contract owns modality, Escape, backdrop dismissal and focus return. -->
<Dialog open={true} title={`Delete "${name}"?`} size="sm" onclose={onCancel}>
  <p class="confirm-desc">{m.builder_deleteDesc({ type })}</p>
  {#snippet footer()}
    <Button variant="ghost" type="button" class="confirm-btn cancel" onclick={onCancel}
      >{m.common_cancel()}</Button
    >
    <Button variant="ghost" type="button" class="confirm-btn delete" onclick={onConfirm}
      >{m.common_delete()}</Button
    >
  {/snippet}
</Dialog>

<style>
  .confirm-desc {
    font-size: var(--font-size-caption);
    color: var(--color-muted);
    margin: 0;
    line-height: 1.4;
  }

  :global(.confirm-btn) {
    font-family: inherit;
    font-size: var(--font-size-caption);
    font-weight: 600;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-standard);
    border: none;
  }

  :global(.confirm-btn.cancel) {
    background: var(--color-bg2);
    color: var(--color-muted);
    border: 1px solid var(--color-border);
  }

  :global(.confirm-btn.cancel:hover) {
    color: var(--color-foreground);
    border-color: var(--color-foreground);
  }

  :global(.confirm-btn.delete) {
    background: var(--color-danger-fg);
    color: white;
  }

  :global(.confirm-btn.delete:hover) {
    filter: brightness(1.1);
  }
</style>
