<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { submitOnModEnter } from '$lib/hotkeys';
  import { Button } from '@minion-stack/ui';
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';

  interface Props {
    mode: 'assign' | 'conversation';
    agentName: string;
    value: string;
    onValueChange: (v: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
  }

  let { mode, agentName, value, onValueChange, onSubmit, onCancel }: Props = $props();
</script>

<Dialog
  open={true}
  title={mode === 'assign' ? m.workshop_assignTask() : m.workshop_startConversation()}
  description={agentName}
  initialFocus="textarea"
  onclose={onCancel}
>
  <label class="task-input t-label">
    {mode === 'assign' ? m.workshop_describeTask() : m.workshop_whatToDiscuss()}
    <textarea
      class="t-body"
      {value}
      oninput={(e) => onValueChange((e.target as HTMLTextAreaElement).value)}
      {@attach submitOnModEnter(onSubmit)}></textarea>
  </label>
  <p class="task-hint t-caption">{m.workshop_taskPromptHint()}</p>
  {#snippet footer()}
    <Button variant="secondary" onclick={onCancel}>{m.common_cancel()}</Button>
    <Button variant="primary" onclick={onSubmit}>
      {mode === 'assign' ? m.workshop_send() : m.workshop_start()}
    </Button>
  {/snippet}
</Dialog>

<style>
  .task-input {
    display: grid;
    gap: var(--space-field-gap);
    color: var(--color-text-primary);
  }
  textarea {
    width: 100%;
    min-height: calc(var(--control-height-touch) * 2);
    padding: var(--space-2);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius-sm);
    resize: vertical;
  }
  .task-hint {
    color: var(--color-text-secondary);
    margin-top: var(--space-2);
  }
</style>
