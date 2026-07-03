<script lang="ts">
  import { invalidate } from '$app/navigation';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let { open = $bindable(false), brainId }: { open?: boolean; brainId: string } = $props();

  let title = $state('');
  let url = $state('');
  let error = $state('');
  let saving = $state(false);

  const canSubmit = $derived(title.trim().length > 0 && url.trim().length > 0);

  function reset() {
    title = '';
    url = '';
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
        body: JSON.stringify({ title: title.trim(), sourceType: 'url', sourceRef: url.trim() }),
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

<Modal bind:open title={m.brains_url_title()}>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <label class="text-xs font-medium text-white/70" for="url-doc-title">{m.brains_url_name()}</label>
      <input
        id="url-doc-title"
        type="text"
        bind:value={title}
        placeholder={m.brains_url_name_ph()}
        autocomplete="off"
        class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <label class="text-xs font-medium text-white/70" for="url-doc-ref">{m.brains_url_ref()}</label>
      <input
        id="url-doc-ref"
        type="url"
        bind:value={url}
        placeholder={m.brains_url_ref_ph()}
        autocomplete="off"
        class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
      />
    </div>

    {#if error}
      <p class="text-xs text-red-400">{error}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="primary" size="sm" disabled={!canSubmit || saving} loading={saving} onclick={submit}>
      {m.brains_url_submit()}
    </Button>
  {/snippet}
</Modal>
