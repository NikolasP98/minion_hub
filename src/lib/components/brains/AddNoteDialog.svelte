<script lang="ts">
  import { Carta, MarkdownEditor } from 'carta-md';
  import 'carta-md/default.css';
  import DOMPurify from 'dompurify';
  import { invalidate } from '$app/navigation';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let { open = $bindable(false), brainId }: { open?: boolean; brainId: string } = $props();

  const carta = new Carta({ sanitizer: (html) => DOMPurify.sanitize(html) });

  let title = $state('');
  let content = $state('');
  let error = $state('');
  let saving = $state(false);

  const canSubmit = $derived(title.trim().length > 0 && content.trim().length > 0);

  function reset() {
    title = '';
    content = '';
    error = '';
  }

  async function submit() {
    if (!canSubmit || saving) return;
    saving = true;
    error = '';
    try {
      const res = await fetch(`/api/brains/${encodeURIComponent(brainId)}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), sourceType: 'note', contentMd: content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = (body as { message?: string }).message ?? `Error ${res.status}`;
        return;
      }
      await invalidate('brains:detail');
      open = false;
      reset();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      saving = false;
    }
  }
</script>

<Modal bind:open title={m.brains_note_title()} size="lg">
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <label class="text-xs font-medium text-white/70" for="note-title">{m.brains_note_name()}</label>
      <input
        id="note-title"
        type="text"
        bind:value={title}
        placeholder={m.brains_note_name_ph()}
        autocomplete="off"
        class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-white/70">{m.brains_note_content()}</span>
      <div class="note-carta h-64 overflow-hidden rounded-lg border border-white/10">
        <MarkdownEditor {carta} bind:value={content} mode="tabs" theme="dark" placeholder={m.brains_note_content()} />
      </div>
    </div>

    {#if error}
      <p class="text-xs text-red-400">{error}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="primary" size="sm" disabled={!canSubmit || saving} loading={saving} onclick={submit}>
      {m.brains_note_submit()}
    </Button>
  {/snippet}
</Modal>

<style>
  .note-carta :global(.carta-theme__dark.carta-editor) {
    height: 100%;
    border: none;
    border-radius: 0;
  }
  .note-carta :global(.carta-container) {
    height: 100%;
  }
  .note-carta :global(.carta-input),
  .note-carta :global(.carta-renderer) {
    height: 100%;
    overflow-y: auto;
  }
</style>
