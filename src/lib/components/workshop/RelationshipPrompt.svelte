<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';
  import { Button } from '$lib/components/ui';

  let {
    fromName,
    toName,
    x,
    y,
    onSubmit,
    onCancel,
  }: {
    fromName: string;
    toName: string;
    x: number;
    y: number;
    onSubmit: (label: string) => void;
    onCancel: () => void;
  } = $props();

  let label = $state('');
  const uid = $props.id();
  const titleId = `${uid}-title`;

  // A submit unmounts the prompt, and the dialog reports that as a close: it is not a cancel.
  let submitted = false;
  function handleSubmit() {
    if (!label.trim()) return;
    submitted = true;
    onSubmit(label.trim());
  }

  // Escape and a click outside belong to the shared Dialog (native `cancel` / backdrop).
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    // The submit closes the prompt and focus moves back at once; without this the rest of
    // the same key press lands on whatever got focus (a button would be activated).
    e.preventDefault();
    handleSubmit();
  }
</script>

<!-- A real modal dialog (spec 152): the canvas behind is inert, Escape and a click outside
     cancel, focus returns to the canvas. `bare` + a clear backdrop keep today's look: a small
     card anchored where the link was drawn, with the canvas fully visible behind it. -->
<Dialog
  open
  presentation="bare"
  backdrop="clear"
  labelledBy={titleId}
  hideClose
  guardDismiss={false}
  initialFocus="[data-link-label]"
  onclose={() => !submitted && onCancel()}
>
  <div
    class="fixed w-60 rounded-lg border border-border bg-bg2 p-3 shadow-xl"
    style="left: {x}px; top: {y}px; transform: translate(-50%, -50%);"
  >
    <div class="mb-2 font-mono text-xs text-muted" id={titleId}>
      {m.workshop_linkTitle({ fromName, toName })}
    </div>

    <input
      data-link-label
      bind:value={label}
      type="text"
      aria-labelledby={titleId}
      placeholder={m.workshop_linkPlaceholder()}
      class="mb-2 w-full rounded border border-border bg-bg3 px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-accent"
      onkeydown={handleKeydown}
    />

    <div class="flex justify-end gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="rounded px-2 py-1 font-mono text-xs text-muted hover:text-foreground"
        onclick={onCancel}
      >
        {m.common_cancel()}
      </Button>
      <Button
        type="button"
        variant="primary"
        size="sm"
        class="rounded border border-accent/30 bg-accent/20 px-2 py-1 font-mono text-xs text-accent hover:bg-accent/30"
        onclick={handleSubmit}
        disabled={!label.trim()}
      >
        {m.workshop_link()}
      </Button>
    </div>
  </div>
</Dialog>
