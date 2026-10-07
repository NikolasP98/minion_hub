<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';
  import { autosize } from '$lib/actions/autosize';
  import { Loader2, BookOpen } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import EmojiPicker from './EmojiPicker.svelte';

  interface Props {
    onComplete: (id: string) => void;
    onClose: () => void;
  }

  let { onComplete, onClose }: Props = $props();

  let name = $state('');
  let description = $state('');
  let emoji = $state('📖');
  let creating = $state(false);
  let error = $state<string | null>(null);

  const canCreate = $derived(name.trim().length >= 2);

  async function handleCreate() {
    if (!canCreate || creating) return;
    creating = true;
    error = null;
    try {
      const res = await fetch('/api/builder/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), emoji }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      onComplete(data.id);
    } catch (e) {
      error = e instanceof Error ? e.message : m.builder_failedCreateSkill();
      creating = false;
    }
  }

  // Escape belongs to the shared Dialog (native `cancel`); Enter still creates.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && canCreate && !creating) handleCreate();
  }
</script>

<!-- HC-028: mounted by the parent `{#if showSkillWizard}`; the shared native
     <dialog> contract owns modality, Escape, backdrop dismissal and focus return. -->
<Dialog open={true} labelledBy="skill-wizard-title" size="md" onclose={onClose}>
  {#snippet header()}
    <div class="header-left">
      <BookOpen size={16} class="text-accent" />
      <span class="modal-title" id="skill-wizard-title">{m.builder_newSkill()}</span>
    </div>
  {/snippet}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-body" onkeydown={handleKeydown}>
    <div class="name-row">
      <EmojiPicker
        value={emoji}
        onSelect={(e) => {
          emoji = e;
        }}
        size="md"
      />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="name-input"
        type="text"
        bind:value={name}
        placeholder={m.builder_skillNamePlaceholder()}
        autofocus
      />
    </div>

    <textarea
      class="desc-input"
      use:autosize={description}
      bind:value={description}
      placeholder={m.builder_skillDescPlaceholder()}></textarea>

    {#if error}
      <p class="error-text">{error}</p>
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" class="btn cancel" onclick={onClose}>{m.common_cancel()}</Button>
    <Button
      variant="ghost"
      class="btn create"
      onclick={handleCreate}
      disabled={!canCreate || creating}
    >
      {#if creating}
        <Loader2 size={14} class="spin" />
        {m.builder_creating()}
      {:else}
        {m.builder_createSkill()}
      {/if}
    </Button>
  {/snippet}
</Dialog>

<style>
  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .modal-title {
    font-size: var(--font-size-body);
    font-weight: 700;
    color: var(--color-foreground);
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .name-input {
    flex: 1;
    font-size: var(--font-size-page-title);
    font-weight: 600;
    color: var(--color-foreground);
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--color-border);
    padding: var(--space-2) 0;
    outline: none;
    font-family: inherit;
    transition: border-color var(--duration-fast);
  }
  .name-input:focus {
    border-bottom-color: var(--color-accent);
  }
  .name-input::placeholder {
    color: var(--color-muted);
  }

  .desc-input {
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-foreground);
    font-family: inherit;
    font-size: var(--font-size-body);
    padding: var(--space-2) var(--space-2);
    outline: none;
    resize: vertical;
    transition: border-color var(--duration-fast);
  }
  .desc-input:focus {
    border-color: var(--color-accent);
  }
  .desc-input::placeholder {
    color: var(--color-muted);
  }

  .error-text {
    font-size: var(--font-size-caption);
    color: var(--color-danger-fg);
    margin: 0;
  }

  :global(.btn) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: inherit;
    font-size: var(--font-size-body);
    font-weight: 600;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-standard);
    border: none;
  }

  :global(.btn.cancel) {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-muted);
  }
  :global(.btn.cancel:hover) {
    color: var(--color-foreground);
    border-color: var(--color-foreground);
  }

  :global(.btn.create) {
    background: var(--color-accent);
    color: white;
  }
  :global(.btn.create:hover:not(:disabled)) {
    filter: brightness(1.15);
  }
  :global(.btn.create:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
