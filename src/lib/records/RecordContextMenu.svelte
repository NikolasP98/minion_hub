<script lang="ts">
  import type { Snippet } from 'svelte';
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import { findRecordAction, type RecordAction } from './actions';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';
  let {
    actions,
    children,
    label = m.shell_record_actions(),
  }: {
    actions: RecordAction[];
    children: Snippet;
    label?: string;
  } = $props();
  let at = $state<{ x: number; y: number } | null>(null);
  let host: HTMLDivElement;
  function open(event: MouseEvent | KeyboardEvent) {
    if (
      !actions.length ||
      event.defaultPrevented ||
      (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const rect = host.getBoundingClientRect();
    at =
      event instanceof MouseEvent
        ? { x: event.clientX, y: event.clientY }
        : { x: rect.left, y: rect.top };
  }
  function close() {
    at = null;
    host?.focus({ preventScroll: true });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="record-context-host"
  bind:this={host}
  tabindex={actions.length ? 0 : undefined}
  oncontextmenu={open}
  onkeydown={(event) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event);
  }}
>
  {@render children()}
</div>
{#if at && actions.length}
  <ContextMenu
    {...at}
    items={actions}
    {label}
    onclose={close}
    onselect={(item) => {
      const action = findRecordAction(actions, item.id);
      if (!action || action.disabled) return;
      close();
      Promise.resolve()
        .then(() => action.run?.())
        .catch(() => toastError(m.common_error()));
    }}
  />
{/if}

<style>
  .record-context-host {
    min-width: 0;
  }
</style>
