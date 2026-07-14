<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { submitOnModEnter } from '$lib/hotkeys';
  import { Button } from '$lib/components/ui';

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

<div
  class="fixed inset-0 z-[var(--layer-modal)] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg)_40%,transparent)] backdrop-blur-sm"
>
  <div class="bg-bg2 border border-border rounded-lg shadow-xl w-96 max-w-[90vw] p-4">
    <h3 class="text-xs font-mono text-foreground mb-1">
      {mode === 'assign' ? m.workshop_assignTask() : m.workshop_startConversation()}
    </h3>
    <p class="text-xs text-muted mb-3">
      {agentName}
    </p>
    <textarea
      class="w-full h-24 bg-bg1 border border-border rounded px-2 py-1.5 text-xs text-foreground font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent"
      placeholder={mode === 'assign' ? m.workshop_describeTask() : m.workshop_whatToDiscuss()}
      {value}
      oninput={(e) => onValueChange((e.target as HTMLTextAreaElement).value)}
      {@attach submitOnModEnter(onSubmit)}></textarea>
    <div class="flex justify-end gap-2 mt-3">
      <Button
        variant="secondary"
        size="sm"
        class="px-3 py-1 text-xs font-mono text-muted hover:text-foreground border border-border rounded transition-colors"
        onclick={onCancel}
      >
        {m.common_cancel()}
      </Button>
      <Button
        variant="primary"
        size="sm"
        class="px-3 py-1 text-xs font-mono text-accent-foreground bg-accent hover:bg-accent/90 rounded transition-colors disabled:opacity-40"
        onclick={onSubmit}
      >
        {mode === 'assign' ? m.workshop_send() : m.workshop_start()}
      </Button>
    </div>
    <p class="text-xs text-muted mt-2">
      {m.workshop_taskPromptHint()}
    </p>
  </div>
</div>
