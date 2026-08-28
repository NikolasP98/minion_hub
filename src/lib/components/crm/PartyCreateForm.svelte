<script lang="ts">
  import { Button, Input, Select } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { CreatablePartyType, PartyOption } from './party-picker';

  let {
    allowedTypes,
    oncreated,
    oncancel,
    initialName = '',
  }: {
    allowedTypes: CreatablePartyType[];
    oncreated: (party: PartyOption) => void;
    oncancel: () => void;
    initialName?: string;
  } = $props();

  // svelte-ignore state_referenced_locally -- form seeds are intentionally one-shot
  let type = $state<CreatablePartyType>(allowedTypes[0] ?? 'person');
  // svelte-ignore state_referenced_locally -- form seeds are intentionally one-shot
  let name = $state(initialName);
  let phone = $state('');
  let email = $state('');
  // svelte-ignore state_referenced_locally -- document default follows the one-shot type seed
  let docType = $state(type === 'company' ? 'RUC' : 'DNI');
  let docNumber = $state('');
  let busy = $state(false);
  let createError = $state<string | null>(null);

  const valid = $derived(name.trim() !== '' && allowedTypes.includes(type));

  function changeType(value: string | number) {
    const next = value === 'company' ? 'company' : 'person';
    type = next;
    if (docType === 'DNI' || docType === 'RUC') docType = next === 'company' ? 'RUC' : 'DNI';
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    busy = true;
    createError = null;
    try {
      const response = await fetch('/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          docType: docNumber.trim() ? docType.trim() || null : null,
          docNumber: docNumber.trim() || null,
        }),
      });
      if (!response.ok) {
        createError = m.party_picker_create_failed();
        return;
      }
      const payload = (await response.json()) as {
        party: {
          id: string;
          name: string | null;
          phone9?: string | null;
          docNumber?: string | null;
        };
      };
      oncreated({
        id: payload.party.id,
        name: payload.party.name ?? name.trim(),
        type,
        email: email.trim() || null,
        docNumber: payload.party.docNumber ?? (docNumber.trim() || null),
        phone9: payload.party.phone9 ?? null,
      });
    } catch {
      createError = m.party_picker_create_failed();
    } finally {
      busy = false;
    }
  }
</script>

<form class="party-create" onsubmit={submit}>
  <div class="party-fields">
    <Input size="sm" label={m.party_picker_name()} required bind:value={name} />
    <Select
      size="sm"
      label={m.party_picker_type()}
      value={type}
      options={allowedTypes.map((value) => ({
        value,
        label: value === 'company' ? m.party_picker_type_company() : m.party_picker_type_person(),
      }))}
      onchange={changeType}
    />
    <Input size="sm" type="tel" label={m.party_picker_phone()} bind:value={phone} />
    <Input size="sm" type="email" label={m.party_picker_email()} bind:value={email} />
    <Input size="sm" label={m.party_picker_document_type()} bind:value={docType} />
    <Input size="sm" label={m.party_picker_document_number()} bind:value={docNumber} />
  </div>
  {#if createError}<p class="party-error t-caption" role="alert">{createError}</p>{/if}
  <div class="party-actions">
    <Button type="button" variant="outline" size="sm" onclick={oncancel}>
      {m.common_cancel()}
    </Button>
    <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!valid}>
      {m.party_picker_create()}
    </Button>
  </div>
</form>

<style>
  .party-create {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .party-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .party-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }
  .party-error {
    color: var(--color-danger-fg);
  }
  @media (max-width: 47.99875rem) {
    .party-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
