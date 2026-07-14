<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import * as editable from '@zag-js/editable';
  import { useMachine, normalizeProps } from '@zag-js/svelte';
  import { Pencil, Check, X } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';

  let nextId = 0;
  const machineId = `name-edit-${nextId++}`;

  let {
    value,
    placeholder = m.usersui_yourName(),
    onCommit,
  }: {
    value: string;
    placeholder?: string;
    onCommit: (name: string) => Promise<boolean> | boolean;
  } = $props();

  let saving = $state(false);

  const service = useMachine(editable.machine as any, () => ({
    id: machineId,
    value,
    placeholder,
    activationMode: 'dblclick' as const,
    submitMode: 'both' as const,
    selectOnFocus: true,
    async onValueCommit({ value: next }: { value: string }) {
      const name = next.trim();
      if (!name || name === value) {
        api.setValue(value);
        return;
      }
      saving = true;
      const ok = await onCommit(name);
      saving = false;
      if (!ok) api.setValue(value); // revert on failure
    },
  }));

  const api = $derived(editable.connect(service as any, normalizeProps));
</script>

<div {...api.getRootProps()} class="group/name inline-flex items-center gap-1.5 max-w-full">
  <div {...api.getAreaProps()} class="inline-flex items-center min-w-0">
    <!-- Preview: the name, double-click (or pencil) to edit -->
    <span
      {...api.getPreviewProps()}
      class="truncate text-xl font-semibold text-foreground leading-tight cursor-text rounded px-0.5 -mx-0.5 hover:bg-bg3"
    >
      {api.valueText}
    </span>
    <input
      {...api.getInputProps()}
      class="min-w-0 bg-transparent text-xl font-semibold text-foreground leading-tight outline-none border-b border-accent px-0.5 -mx-0.5"
    />
  </div>

  {#if api.editing}
    <Button variant="ghost" size="xs"
      {...api.getSubmitTriggerProps()}
      class="grid place-items-center h-6 w-6 rounded text-accent hover:bg-accent/15 bg-transparent border-none cursor-pointer shrink-0 disabled:opacity-50"
      disabled={saving}
      aria-label={m.usersui_saveName()}
    >
      <Check size={14} />
    </Button>
    <Button variant="ghost" size="xs"
      {...api.getCancelTriggerProps()}
      class="grid place-items-center h-6 w-6 rounded text-muted hover:text-foreground hover:bg-bg3 bg-transparent border-none cursor-pointer shrink-0"
      aria-label={m.common_cancel()}
    >
      <X size={14} />
    </Button>
  {:else}
    <Button variant="ghost" size="xs"
      {...api.getEditTriggerProps()}
      class="grid place-items-center h-6 w-6 rounded text-muted hover:text-foreground hover:bg-bg3 bg-transparent border-none cursor-pointer shrink-0 opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100 transition-opacity"
      aria-label={m.usersui_editName()}
    >
      <Pencil size={13} />
    </Button>
  {/if}
</div>
