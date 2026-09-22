<script lang="ts">
  import { Button, Input, Select } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import type { PartyOption } from '$lib/components/crm/party-picker';
  import { metaLabel } from '$lib/components/crm/crm-meta';
  import { canAct } from '$lib/access/can.svelte';
  import { canAutofillPeruvianDni, docFromQuery, shouldApplyDniLookup } from './customer-quick-add';

  let {
    oncreated,
    oncancel,
    initialQuery = '',
  }: {
    oncreated: (party: PartyOption) => void;
    oncancel: () => void;
    initialQuery?: string;
  } = $props();

  // svelte-ignore state_referenced_locally -- one-shot picker seed
  const seed = docFromQuery(initialQuery);
  // svelte-ignore state_referenced_locally -- one-shot picker seed
  let type = $state<'person' | 'company'>(seed.length === 11 ? 'company' : 'person');
  // svelte-ignore state_referenced_locally -- one-shot picker seed
  let name = $state(seed ? '' : initialQuery);
  let phone = $state('');
  let email = $state('');
  // svelte-ignore state_referenced_locally -- one-shot picker seed
  let docType = $state(seed.length === 11 ? 'RUC' : 'DNI');
  // svelte-ignore state_referenced_locally -- one-shot picker seed
  let docNumber = $state(seed);
  let dob = $state('');
  let sex = $state('');
  let district = $state('');
  let address = $state('');
  let nationality = $state('');
  let occupation = $state('');
  let reason = $state('');
  let referral = $state('');
  let extraKeys = $state<string[]>([]);
  let extras = $state<Record<string, string>>({});
  let busy = $state(false);
  let lookupBusy = $state(false);
  let err = $state<string | null>(null);
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const canDniLookup = $derived(canAutofillPeruvianDni(type, docType, docNumber));
  const canViewCrm = $derived(canAct('crm', 'view'));
  const valid = $derived(name.trim().length > 0);
  const standard = new Set([
    'dni',
    'nombre',
    'edad',
    'fecha_nacimiento',
    'sexo',
    'telefono',
    'phone',
    'email',
    'correo',
    'distrito',
    'domicilio',
    'direccion',
    'nacionalidad',
    'ocupacion',
    'motivo',
    'referencia',
  ]);

  $effect(() => {
    if (!canViewCrm) return;
    let active = true;
    fetch('/api/crm/meta-keys')
      .then((r) => (r.ok ? (r.json() as Promise<{ keys: string[] }>) : { keys: [] }))
      .then(({ keys }) => {
        if (active)
          extraKeys = keys.filter((k) => !k.startsWith('_') && !standard.has(k.toLowerCase()));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  });

  function changeType(value: string | number) {
    type = value === 'company' ? 'company' : 'person';
    if (type === 'company') {
      dob = '';
      sex = '';
    }
    if (docType === 'DNI' || docType === 'RUC') docType = type === 'company' ? 'RUC' : 'DNI';
  }

  async function lookupDni() {
    if (!canDniLookup || lookupBusy) return;
    lookupBusy = true;
    const requestedDni = docNumber;
    err = null;
    try {
      const res = await fetch('/api/crm/dni-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dni: docNumber }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const hit = (await res.json()) as {
        found: boolean;
        name?: string | null;
        dob?: string | null;
        sex?: 'M' | 'F' | null;
      };
      if (!shouldApplyDniLookup(requestedDni, { type, docType, docNumber })) return;
      if (!hit.found) {
        err = m.pos_customer_dni_not_found();
        return;
      }
      if (hit.name) name = hit.name;
      if (hit.dob) dob = hit.dob;
      if (hit.sex) sex = hit.sex;
    } catch {
      err = m.pos_customer_dni_lookup_failed();
    } finally {
      lookupBusy = false;
    }
  }

  function customFields(): Record<string, string> {
    const values = {
      distrito: district,
      direccion: address,
      nacionalidad: nationality,
      ocupacion: occupation,
      motivo: reason,
      referencia: referral,
      ...extras,
    };
    return Object.fromEntries(
      Object.entries(values)
        .filter(([, v]) => v.trim())
        .map(([k, v]) => [k, v.trim()]),
    );
  }

  async function commit() {
    if (!valid || busy) return;
    busy = true;
    err = null;
    const typedPhone = phone.trim() || null;
    try {
      const response = await fetch('/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          name: name.trim(),
          phone: typedPhone,
          email: email.trim() || null,
          docType: docNumber.trim() ? docType : null,
          docNumber: docNumber.trim() || null,
          dob: type === 'person' ? dob || null : null,
          sex: type === 'person' ? sex || null : null,
          customFields: customFields(),
        }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { code?: string } | null;
        err =
          failure?.code === 'document_type_conflict'
            ? m.pos_customer_quick_document_conflict()
            : m.pos_customer_quick_create_failed();
        return;
      }
      const { party, contactId } = (await response.json()) as {
        contactId: string;
        party: {
          id: string;
          name: string | null;
          phone9: string | null;
          docNumber: string | null;
        };
      };
      oncreated({
        id: party.id,
        name: party.name ?? name.trim(),
        type,
        email: email.trim() || null,
        docNumber: party.docNumber,
        phone9: party.phone9,
        contactId,
      });
    } catch {
      err = m.party_picker_create_failed();
    } finally {
      busy = false;
    }
  }
</script>

<form
  class="quick-add"
  onsubmit={(e) => {
    e.preventDefault();
    void commit();
  }}
>
  <div class="fields">
    <Select
      size="sm"
      label={m.party_picker_type()}
      bind:value={type}
      options={[
        { value: 'person', label: m.party_picker_type_person() },
        { value: 'company', label: m.party_picker_type_company() },
      ]}
      onchange={changeType}
    />
    <Input size="sm" label={m.party_picker_name()} required bind:value={name} />
    <Input size="sm" type="tel" label={m.party_picker_phone()} bind:value={phone} />
    <Input size="sm" type="email" label={m.party_picker_email()} bind:value={email} />
    <Select
      size="sm"
      label={m.party_picker_document_type()}
      bind:value={docType}
      options={[
        { value: 'DNI', label: 'DNI' },
        { value: 'CE', label: m.pos_customer_quick_doc_ce() },
        { value: 'PASSPORT', label: m.pos_customer_quick_doc_passport() },
        { value: 'RUC', label: 'RUC' },
        { value: 'OTHER', label: m.pos_customer_quick_doc_other() },
      ]}
    />
    <div class="document-row">
      <Input size="sm" label={m.party_picker_document_number()} bind:value={docNumber} />
      {#if canDniLookup}
        <Button type="button" variant="outline" size="sm" loading={lookupBusy} onclick={lookupDni}>
          {m.pos_customer_quick_dni_autofill()}
        </Button>
      {/if}
    </div>
    {#if type === 'person'}
      <FormField label={m.crm_std_dob()}>
        {#snippet children(control)}<input
            {...control}
            class="date-input"
            type="date"
            max={localToday}
            bind:value={dob}
          />{/snippet}
      </FormField>
      <Select
        size="sm"
        label={m.crm_std_sex()}
        bind:value={sex}
        options={[
          { value: '', label: m.pos_customer_quick_unspecified() },
          { value: 'F', label: m.crm_sex_f() },
          { value: 'M', label: m.crm_sex_m() },
        ]}
      />
    {/if}
    <Input size="sm" label={m.crm_std_district()} bind:value={district} />
    <Input size="sm" label={m.pos_customer_quick_address()} bind:value={address} />
    <Input size="sm" label={m.pos_customer_quick_nationality()} bind:value={nationality} />
    <Input size="sm" label={m.pos_customer_quick_occupation()} bind:value={occupation} />
    <Input size="sm" label={m.crm_std_reason()} bind:value={reason} />
    <Input size="sm" label={m.crm_std_referral()} bind:value={referral} />
    {#each extraKeys as key (key)}
      <Input
        size="sm"
        label={metaLabel(key)}
        value={extras[key] ?? ''}
        oninput={(e: Event) => {
          extras = { ...extras, [key]: (e.currentTarget as HTMLInputElement).value };
        }}
      />
    {/each}
  </div>
  {#if err}<p class="quick-err t-caption" role="alert">{err}</p>{/if}
  <div class="quick-actions">
    <Button type="button" variant="outline" size="sm" onclick={oncancel}>{m.common_cancel()}</Button
    >
    <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!valid || lookupBusy}
      >{m.common_add()}</Button
    >
  </div>
</form>

<style>
  .quick-add {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: calc(var(--space-12) * 10);
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(calc(var(--space-12) * 3), 1fr));
    gap: var(--space-3);
  }
  .document-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    min-width: 0;
  }
  .document-row :global([data-part='field']) {
    min-width: 0;
    flex: 1;
  }
  .date-input {
    width: 100%;
    min-height: var(--control-height-sm);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--space-2);
  }
  .quick-err {
    margin: 0;
    color: var(--color-danger-fg);
  }
  .quick-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-subtle);
  }
</style>
