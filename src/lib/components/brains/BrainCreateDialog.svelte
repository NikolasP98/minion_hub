<script lang="ts">
  import { invalidate, goto } from '$lib/navigation';
  import { Button, Input, Select } from '$lib/components/ui';
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';
  import { fetchJson } from '$lib/api/fetch-json';
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
      const brain = await fetchJson<{ id: string }>('/api/brains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          icon: icon.trim() || null,
          visibility,
        }),
      });
      await invalidate('brains:list');
      open = false;
      reset();
      await goto(`/brains/${encodeURIComponent(brain.id)}`);
    } catch (e) {
      error = e instanceof Error ? e.message : m.common_error();
    } finally {
      saving = false;
    }
  }
</script>

<Dialog bind:open title={m.brains_create_title()} size="md">
  <div class="brain-form">
    <Input
      id="brain-name"
      label={m.brains_create_name()}
      bind:value={name}
      placeholder={m.brains_create_name_ph()}
      autocomplete="off"
    />

    <div class="identity-fields">
      <Input
        id="brain-desc"
        label={m.brains_create_desc()}
        bind:value={description}
        placeholder={m.brains_create_desc_ph()}
        autocomplete="off"
      />
      <Input
        id="brain-icon"
        label={m.brains_create_icon()}
        bind:value={icon}
        maxlength="8"
        placeholder={m.brains_create_icon_ph()}
        autocomplete="off"
      />
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
      <p class="form-error" role="alert">{error}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" size="sm" disabled={saving} onclick={() => (open = false)}>
      {m.common_cancel()}
    </Button>
    <Button
      variant="primary"
      size="sm"
      disabled={!canSubmit || saving}
      loading={saving}
      onclick={submit}
    >
      {m.brains_create_submit()}
    </Button>
  {/snippet}
</Dialog>

<style>
  .brain-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .identity-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(8rem, 0.35fr);
    gap: var(--space-3);
  }

  .form-error {
    color: var(--color-danger-fg);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  @media (max-width: 767.98px) {
    .identity-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
