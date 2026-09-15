<script module lang="ts">
  /**
   * A DNI typed into the picker's BROWSE search box should not be retyped here.
   * Only an exact 8-digit number seeds the form: the search also matches names,
   * emails and phones, and seeding the DNI field with "ana" would be worse than
   * leaving it blank. Digits are extracted first, so "DNI 60525600" still seeds.
   */
  export function dniFromQuery(query: string | null | undefined): string {
    const digits = (query ?? '').replace(/\D/g, '');
    return digits.length === 8 ? digits : '';
  }
</script>

<script lang="ts">
  import { Button, Input } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { PartyOption } from '$lib/components/crm/party-picker';

  let {
    oncreated,
    oncancel,
    onticketonly,
    initialQuery = '',
  }: {
    /** Picker create-context: hands the picker a row to select and close on. */
    oncreated: (party: PartyOption) => void;
    oncancel: () => void;
    /** `POST /api/crm/parties` refused (no crm:create, or offline): keep the
     *  sale moving with a ticket-only name. The server still blocks submit when
     *  the org REQUIRES a document. */
    onticketonly: (name: string, phone: string | null) => void;
    /** The picker's current browse search term (`PickerCreateContext.query`). */
    initialQuery?: string;
  } = $props();

  // svelte-ignore state_referenced_locally -- seeds the editable field once
  let dni = $state(dniFromQuery(initialQuery));
  /** The name the registry gave this DNI — set once the lookup resolves, which
   *  is what opens the optional phone row. */
  let resolvedName = $state<string | null>(null);
  /** Set only when the registry could not name the DNI — the manual-name
   *  fallback is the LAST rung, never the first thing the counter sees. */
  let manualNeeded = $state(false);
  let manualName = $state('');
  /** Optional — a brand-new client with no phone has nothing the WhatsApp
   *  appointment reminder can be sent to (owner: "yes, optional phone"). */
  let phone = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);

  const resolved = $derived(Boolean(resolvedName) || manualNeeded);

  function onDniInput() {
    dni = dni.replace(/\D/g, '').slice(0, 8);
    // Any edit invalidates a previous resolution: the next submit searches again.
    manualNeeded = false;
    resolvedName = null;
    err = null;
  }

  function onPhoneInput() {
    // Peru local number; `ensureParty` keys on the last 9 digits (phone9).
    phone = phone.replace(/\D/g, '').slice(0, 9);
  }

  /**
   * DNI-first quick add (owner directive): the counter types ONE number.
   *
   * The ladder, cheapest rung first — unchanged from the pre-Picker form:
   *   1. already a client → the party search already covers doc_number, so an
   *      exact `docNumber` hit is SELECTED, never duplicated. This is why the
   *      create path can never fight the browse tab: the same number resolves
   *      to the same one client either way;
   *   2. new person → the existing PERUDEVS registry lookup (`/api/crm/dni-lookup`,
   *      the same endpoint the CRM details form and RUC autofill use) names them
   *      and `POST /api/crm/parties` creates the party (ensureParty dedups on
   *      doc_number again, server-side);
   *   3. registry miss/outage ONLY → fall back to typing the name by hand, with
   *      the DNI still attached.
   */
  async function resolve() {
    if (busy) return;
    if (dni.length !== 8) {
      err = m.pos_customer_dni_invalid();
      return;
    }
    busy = true;
    err = null;
    try {
      // 1 — already registered? Take the party as-is, phone included.
      const found = await fetch(`/api/crm/parties?q=${encodeURIComponent(dni)}&type=person`).then(
        (r) => (r.ok ? (r.json() as Promise<PartyOption[]>) : []),
      );
      const existing = found.find((p) => p.docNumber === dni);
      if (existing) {
        oncreated(existing);
        return;
      }

      // 2 — registry lookup names the new person.
      const res = await fetch('/api/crm/dni-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dni }),
      });
      const j = res.ok ? ((await res.json()) as { found: boolean; name?: string }) : null;
      if (j?.found && j.name) {
        resolvedName = j.name;
        return;
      }

      // 3 — registry could not name it: ask for the name, keep the DNI.
      manualNeeded = true;
      err = m.pos_customer_dni_not_found();
    } catch {
      err = m.pos_customer_dni_lookup_failed();
    } finally {
      busy = false;
    }
  }

  /**
   * Commit the resolved DNI (+ the OPTIONAL phone) as a party.
   *
   * The phone is never required and an empty one is valid — but when it IS
   * typed it must persist, because `?step=schedule` books off the party spine
   * and an appointment with no `attendeePhone` has no reminder recipient.
   */
  async function commit() {
    if (busy) return;
    const name = (resolvedName ?? manualName).trim();
    if (!name) {
      err = m.pos_customer_dni_not_found();
      return;
    }
    busy = true;
    err = null;
    const typedPhone = phone.trim() || null;
    try {
      const created = await fetch('/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, docNumber: dni, phone: typedPhone }),
      });
      if (!created.ok) {
        onticketonly(name, typedPhone);
        return;
      }
      const j = (await created.json()) as {
        party: { id: string; phone9: string | null; docNumber: string | null };
      };
      oncreated({
        id: j.party.id,
        name,
        type: 'person',
        email: null,
        docNumber: j.party.docNumber ?? dni,
        phone9: j.party.phone9 ?? typedPhone,
      });
    } catch {
      err = m.pos_customer_dni_lookup_failed();
    } finally {
      busy = false;
    }
  }
</script>

<!-- ONE number drives the whole form: it finds the existing client, or names a
     new one from the registry. The name box only appears when both miss. -->
<form
  class="quick-add"
  onsubmit={(event) => {
    event.preventDefault();
    if (resolved) void commit();
    else void resolve();
  }}
>
  <div class="dni-row">
    <Input
      size="sm"
      inputmode="numeric"
      autocomplete="off"
      label={m.pos_customer_dni_label()}
      placeholder={m.pos_customer_dni_only_ph()}
      bind:value={dni}
      oninput={onDniInput}
      disabled={resolved}
    />
    {#if !resolved}
      <Button type="submit" variant="primary" size="sm" loading={busy}>
        {m.pos_customer_dni_find()}
      </Button>
    {:else}
      <Button type="button" variant="ghost" size="sm" onclick={onDniInput}>
        {m.pos_customer_change()}
      </Button>
    {/if}
  </div>

  {#if resolvedName}
    <p class="resolved t-body">{resolvedName}</p>
  {:else if manualNeeded}
    <Input size="sm" label={m.party_picker_name()} required bind:value={manualName} />
  {/if}

  {#if resolved}
    <Input
      size="sm"
      type="tel"
      inputmode="numeric"
      autocomplete="off"
      label={m.party_picker_phone()}
      placeholder={m.pos_customer_phone_optional_ph()}
      helper={m.pos_customer_phone_reminder_hint()}
      bind:value={phone}
      oninput={onPhoneInput}
    />
  {/if}

  {#if err}<p class="quick-err t-caption" role="alert">{err}</p>{/if}

  <div class="quick-actions">
    <Button type="button" variant="outline" size="sm" onclick={oncancel}>
      {m.common_cancel()}
    </Button>
    {#if resolved}
      <Button type="submit" variant="primary" size="sm" loading={busy}>{m.common_add()}</Button>
    {/if}
  </div>
</form>

<style>
  .quick-add {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: calc(var(--space-12) * 8);
  }
  .dni-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .dni-row :global([data-part='field']) {
    min-width: 0;
    flex: 1;
  }
  .resolved {
    margin: 0;
    color: var(--color-text-primary);
    font-weight: var(--font-weight-medium);
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
