<script lang="ts">
  import { invalidate, goto } from '$app/navigation';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { Button, Select } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let name = $state('');
  let description = $state('');
  let icon = $state('');
  let visibility = $state('org');
  let error = $state('');
  let saving = $state(false);

  const canSubmit = $derived(name.trim().length > 0);

  function reset() {
    name = '';
    description = '';
    icon = '';
    visibility = 'org';
    error = '';
  }

  async function submit() {
    if (!canSubmit || saving) return;
    saving = true;
    error = '';
    try {
      const res = await fetch('/api/brains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          icon: icon.trim() || null,
          visibility,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = (body as { message?: string }).message ?? `Error ${res.status}`;
        return;
      }
      const brain = (await res.json()) as { id: string };
      await invalidate('brains:list');
      open = false;
      reset();
      await goto(`/brains/${encodeURIComponent(brain.id)}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      saving = false;
    }
  }
</script>

<Modal bind:open title={m.brains_create_title()}>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <label class="text-xs font-medium text-white/70" for="brain-name">{m.brains_create_name()}</label>
      <input
        id="brain-name"
        type="text"
        bind:value={name}
        placeholder={m.brains_create_name_ph()}
        autocomplete="off"
        class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
      />
    </div>

    <div class="flex gap-3">
      <div class="flex flex-1 flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="brain-desc">{m.brains_create_desc()}</label>
        <input
          id="brain-desc"
          type="text"
          bind:value={description}
          placeholder={m.brains_create_desc_ph()}
          autocomplete="off"
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
        />
      </div>
      <div class="flex w-20 flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="brain-icon">{m.brains_create_icon()}</label>
        <input
          id="brain-icon"
          type="text"
          bind:value={icon}
          maxlength="8"
          placeholder={m.brains_create_icon_ph()}
          autocomplete="off"
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-center text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
        />
      </div>
    </div>

    <Select
      label={m.brains_create_visibility()}
      bind:value={visibility}
      options={[
        { value: 'org', label: m.brains_visibility_org() },
        { value: 'private', label: m.brains_visibility_private() },
      ]}
    />

    {#if error}
      <p class="text-xs text-red-400">{error}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="primary" size="sm" disabled={!canSubmit || saving} loading={saving} onclick={submit}>
      {m.brains_create_submit()}
    </Button>
  {/snippet}
</Modal>
