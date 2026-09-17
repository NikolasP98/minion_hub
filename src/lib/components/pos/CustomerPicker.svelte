<script lang="ts">
  import { Phone, UserPlus, Wallet, X } from 'lucide-svelte';
  import {
    Badge,
    Button,
    Input,
    Picker,
    iconSizes,
    type PickerColumn,
    type PickerCreateContext,
  } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import type { PartyOption } from '$lib/components/crm/party-picker';
  import * as m from '$lib/paraglide/messages';
  import CustomerQuickAdd from './CustomerQuickAdd.svelte';

  interface Props {
    /** Party-spine linkage — set when the customer exists (or was created) in CRM. */
    partyId: string | null;
    customerName: string | null;
    /** Display + booking attendeePhone passthrough. */
    phone?: string | null;
    /** The selected customer's identity document, so the caller can gate on it
     *  without a second fetch (`pos_settings.requirements.identityDocument`). */
    docNumber?: string | null;
    required?: boolean;
    /** Field label; defaults to the POS "Customer" wording. */
    label?: string;
    /** Org requirement level for an identity document. `'required'` shows the
     *  blocking state on the selected customer; the SERVER is the authority
     *  (submitTicket → `identity_document_required`). */
    documentRequirement?: 'off' | 'optional' | 'required';
  }

  let {
    partyId = $bindable(null),
    customerName = $bindable(null),
    phone = $bindable(null),
    docNumber = $bindable(null),
    required = false,
    label = m.pos_sell_customer(),
    documentRequirement = 'off',
  }: Props = $props();

  /** The whole control is a two-state machine: EMPTY (one button that opens the
   *  picker) or SELECTED (a summary). There is no third "searching" state on
   *  the rail any more — search and create both live inside the picker, so the
   *  cashier never has two competing inputs in front of them. */
  const selected = $derived(customerName !== null);
  const identityBlocking = $derived(documentRequirement === 'required' && !docNumber);

  let pickerOpen = $state(false);

  const columns = $derived<PickerColumn<PartyOption>[]>([
    {
      key: 'name',
      label: m.party_picker_name(),
      value: (p) => p.name ?? m.party_picker_unnamed(),
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      render: nameCell,
    },
    {
      key: 'docNumber',
      label: m.party_picker_document_number(),
      value: (p) => p.docNumber ?? '',
      priority: 20,
    },
    {
      key: 'phone9',
      label: m.party_picker_phone(),
      value: (p) => p.phone9 ?? '',
      priority: 30,
    },
    {
      key: 'email',
      label: m.party_picker_email(),
      value: (p) => p.email ?? '',
      priority: 40,
      defaultHidden: true,
    },
  ]);

  /** One server-side search over name / email / document / phone — the same
   *  endpoint the DNI ladder's first rung uses, which is why the two paths can
   *  never disagree about who is already a client.
   *
   *  The empty-term initial list requests verified clients only (garbage
   *  walk-in rows shouldn't be the first thing a cashier sees); a typed term
   *  searches everyone, ranked verified-first, so a real match outside that
   *  tier is never hidden. */
  async function loadParties(term: string): Promise<PartyOption[]> {
    const params = new URLSearchParams({ q: term, type: 'person' });
    params.set('verified', term.trim() ? 'first' : 'only');
    const res = await fetch(`/api/crm/parties?${params.toString()}`);
    if (!res.ok) throw new Error('party search failed');
    return (await res.json()) as PartyOption[];
  }

  /** Select a party programmatically (assistant fill) — same path as a click. */
  export function pick(p: PartyOption) {
    partyId = p.id;
    customerName = p.name ?? '—';
    phone = p.phone9 ?? null;
    docNumber = p.docNumber ?? null;
  }

  /**
   * Quick-add a walk-in customer without opening the picker — the assistant's
   * path for a new client (`BookingCreateForm`). Find-or-creates the party
   * (dedup on document, then phone); a refusal degrades to a ticket-only name
   * exactly like the picker's own quick-add.
   */
  let addBusy = false;
  export async function add(rawName: string, rawPhone = '', doc: string | null = null) {
    const name = rawName.trim();
    if (!name || addBusy) return;
    const typedPhone = rawPhone.trim() || null;
    addBusy = true;
    try {
      const res = await fetch('/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone: typedPhone, docNumber: doc }),
      });
      if (res.ok) {
        const j = (await res.json()) as {
          party: { id: string; phone9: string | null; docNumber?: string | null };
        };
        partyId = j.party.id;
        phone = j.party.phone9 ?? typedPhone;
        docNumber = j.party.docNumber ?? doc;
      } else {
        // No permission / offline — keep the sale moving as a ticket-only name.
        partyId = null;
        phone = typedPhone;
        docNumber = doc;
      }
    } catch {
      partyId = null;
      phone = typedPhone;
      docNumber = doc;
    } finally {
      customerName = name;
      pickerOpen = false;
      addBusy = false;
    }
  }

  /** `POST /api/crm/parties` refused — keep the sale moving as a ticket-only
   *  name, exactly as the old inline quick-add did. */
  function ticketOnly(name: string, typedPhone: string | null) {
    partyId = null;
    customerName = name;
    phone = typedPhone;
    docNumber = null;
    pickerOpen = false;
  }

  function clear() {
    partyId = null;
    customerName = null;
    phone = null;
    docNumber = null;
    phoneOpen = false;
  }

  /**
   * Fill in the phone of a client ALREADY on file, from the till.
   *
   * The quick-add's optional phone only reaches `POST /api/crm/parties` on the
   * create path, so a long-standing client with no number on file used to book a
   * reminder-less appointment with no way to fix it from here. This PATCHes the
   * CRM's own party-edit route (`PATCH /api/crm/parties/[id]`, gated `crm:edit`
   * centrally) — NOT a second write path — and takes the stored phone9 back so
   * the binding matches what the spine now holds.
   */
  const canEditParty = $derived(canAct('crm', 'edit'));
  let phoneOpen = $state(false);
  let phoneDraft = $state('');
  let phoneBusy = $state(false);
  let phoneErr = $state<string | null>(null);

  function openPhone() {
    phoneDraft = '';
    phoneErr = null;
    phoneOpen = true;
  }

  function onPhoneInput() {
    // Peru local number — the spine keys on the last 9 digits (phone9).
    phoneDraft = phoneDraft.replace(/\D/g, '').slice(0, 9);
  }

  async function savePhone() {
    if (phoneBusy || !partyId) return;
    const typed = phoneDraft.trim();
    if (!typed) return;
    phoneBusy = true;
    phoneErr = null;
    try {
      const res = await fetch(`/api/crm/parties/${partyId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: typed }),
      });
      if (!res.ok) {
        phoneErr = m.pos_customer_phone_save_failed();
        return;
      }
      const j = (await res.json()) as { phone?: string };
      phone = j.phone ?? typed;
      phoneOpen = false;
    } catch {
      phoneErr = m.pos_customer_phone_save_failed();
    } finally {
      phoneBusy = false;
    }
  }
</script>

<!-- A DNI typed in the picker's BROWSE search seeds the quick-add, so the
     cashier types the number once. `PickerCreateContext.query` carries it. -->
{#snippet nameCell(p: PartyOption)}
  <span class="name-cell">
    {p.name ?? m.party_picker_unnamed()}
    {#if p.dniVerified}
      <Badge variant="semantic" value="success" size="sm">{m.party_picker_verified()}</Badge>
    {/if}
  </span>
{/snippet}

{#snippet quickAddForm(ctx: PickerCreateContext<PartyOption>)}
  <CustomerQuickAdd
    oncreated={ctx.oncreated}
    oncancel={ctx.oncancel}
    onticketonly={ticketOnly}
    initialQuery={ctx.query}
  />
{/snippet}

<div class="customer">
  <span class="lbl t-label"
    >{label}{#if required}<span class="req" aria-hidden="true">*</span>{/if}</span
  >

  {#if selected}
    <div class="summary" class:blocking={identityBlocking}>
      <div class="head">
        <span class="name">{customerName}</span>
        <Button
          variant="ghost"
          size="xs"
          shape="icon"
          class="clear"
          aria-label={m.common_remove()}
          onclick={clear}
        >
          <X size={iconSizes.sm} aria-hidden="true" />
        </Button>
      </div>

      <dl class="meta t-caption">
        <div class="meta-row">
          <dt>{m.party_picker_document_number()}</dt>
          <dd class="num" class:absent={!docNumber}>{docNumber ?? m.pos_customer_no_document()}</dd>
        </div>
        <div class="meta-row">
          <dt>{m.party_picker_phone()}</dt>
          <dd class="num" class:absent={!phone}>{phone ?? m.pos_customer_no_phone()}</dd>
        </div>
      </dl>

      <div class="tags">
        {#if partyId}
          <Badge variant="semantic" value="success" size="sm">{m.pos_customer_saved_crm()}</Badge>
        {:else}
          <Badge variant="neutral" size="sm">{m.pos_customer_ticket_only()}</Badge>
        {/if}
        {#if identityBlocking}
          <Badge variant="semantic" value="error" size="sm">
            {m.pos_customer_identity_missing()}
          </Badge>
        {/if}
      </div>

      {#if identityBlocking}
        <p class="alert t-caption" role="alert">{m.pos_customer_identity_required()}</p>
      {:else if !phone}
        <p class="note t-caption">{m.pos_customer_phone_reminder_hint()}</p>
      {/if}

      <!-- A client already on file can now get a phone from the till: the same
           CRM party-edit route the customers table uses, gated by the same
           `crm:edit` capability, so the affordance is absent for a role that
           would only 403 on it. -->
      {#if !phone && partyId && canEditParty}
        {#if phoneOpen}
          <div class="phone-edit">
            <Input
              size="sm"
              type="tel"
              inputmode="numeric"
              autocomplete="off"
              label={m.party_picker_phone()}
              placeholder={m.pos_customer_phone_optional_ph()}
              bind:value={phoneDraft}
              oninput={onPhoneInput}
            />
            <Button variant="primary" size="xs" loading={phoneBusy} onclick={savePhone}>
              {m.common_save()}
            </Button>
            <Button variant="ghost" size="xs" onclick={() => (phoneOpen = false)}>
              {m.common_cancel()}
            </Button>
          </div>
          {#if phoneErr}<p class="alert t-caption" role="alert">{phoneErr}</p>{/if}
        {:else}
          <Button variant="outline" size="xs" class="add-phone" onclick={openPhone}>
            <Phone size={iconSizes.xs} aria-hidden="true" />
            {m.pos_customer_add_phone()}
          </Button>
        {/if}
      {/if}

      <div class="actions">
        <Button variant="outline" size="xs" onclick={() => (pickerOpen = true)}>
          {m.pos_customer_change()}
        </Button>
        {#if partyId}
          <!-- The accounts load resolves this key off the party spine when the
               client has no movements yet, so the link always opens THAT
               client's account rather than the plain list. -->
          <a class="acct t-caption" href={`/pos/accounts?client=party:${partyId}`}>
            <Wallet size={iconSizes.xs} aria-hidden="true" />
            {m.pos_customer_open_account()}
          </a>
        {/if}
      </div>
    </div>
  {:else}
    <Button variant="outline" size="sm" class="select-btn" onclick={() => (pickerOpen = true)}>
      <UserPlus size={iconSizes.sm} aria-hidden="true" />
      {m.pos_customer_select()}
    </Button>
    {#if required}
      <p class="alert t-caption">{m.pos_customer_required()}</p>
    {:else if documentRequirement === 'required'}
      <p class="note t-caption">{m.pos_customer_identity_required()}</p>
    {/if}
  {/if}
</div>

<Picker
  bind:open={pickerOpen}
  title={m.pos_customer_picker_title()}
  subtitle={m.pos_customer_picker_subtitle()}
  {columns}
  loadRows={loadParties}
  getRowId={(p) => p.id}
  onPick={pick}
  selectionMode="single"
  columnsConfigurable
  pickedIds={partyId ? new Set([partyId]) : undefined}
  searchPlaceholder={m.pos_customer_search_ph()}
  emptyLabel={m.pos_customer_picker_empty()}
  storageKey="pos-customer"
  create={{
    label: m.pos_sell_customer_quick_add(),
    tabLabel: m.pos_customer_quick_add_title(),
    description: m.pos_customer_quick_add_desc(),
    form: quickAddForm,
  }}
/>

<style>
  .customer {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .lbl {
    color: var(--color-text-secondary);
  }
  .req {
    margin-left: var(--space-0-5);
    color: var(--color-danger-fg);
  }
  .customer :global(.select-btn) {
    width: 100%;
    justify-content: flex-start;
  }
  .name-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
  }
  .summary.blocking {
    border-color: var(--color-danger-border);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    font-weight: var(--font-weight-medium);
  }
  .summary :global(.clear) {
    flex: none;
  }
  .meta {
    display: grid;
    margin: 0;
    gap: var(--space-0-5);
  }
  .meta-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .meta-row dt {
    color: var(--color-text-tertiary);
  }
  .meta-row dd {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }
  .meta-row dd.num {
    font-variant-numeric: tabular-nums;
  }
  .meta-row dd.absent {
    color: var(--color-text-tertiary);
    font-style: italic;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .alert {
    margin: 0;
    color: var(--color-danger-fg);
  }
  .note {
    margin: 0;
    color: var(--color-text-tertiary);
  }
  .phone-edit {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .phone-edit :global([data-part='field']) {
    min-width: 0;
    flex: 1;
  }
  .summary :global(.add-phone) {
    align-self: flex-start;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .acct {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-accent);
    text-decoration: none;
  }
  .acct:hover {
    text-decoration: underline;
  }
</style>
