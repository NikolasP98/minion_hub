<script lang="ts">
  import { Button, Badge } from '$lib/components/ui';

  import { onDestroy } from 'svelte';
  import { X, UserPlus } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { createAsyncDebouncer } from '$lib/pacer/index.svelte';

  interface PartyResult {
    id: string;
    name: string | null;
    docNumber: string | null;
    phone9: string | null;
  }

  interface Props {
    /** Party-spine linkage — set when the customer exists (or was created) in CRM. */
    partyId: string | null;
    customerName: string | null;
    /** Display + booking attendeePhone passthrough. */
    phone?: string | null;
    required?: boolean;
  }

  let {
    partyId = $bindable(null),
    customerName = $bindable(null),
    phone = $bindable(null),
    required = false,
  }: Props = $props();

  let q = $state('');
  let results = $state<PartyResult[]>([]);
  let open = $state(false);
  let quickAdd = $state(false);
  let quickName = $state('');
  let quickPhone = $state('');
  let quickDni = $state('');
  let quickBusy = $state(false);

  // Party search covers name / email / DNI / phone9 server-side — one input,
  // digits or letters. Async-debounce + seq-guard: a slow response for an
  // earlier keystroke must not overwrite a newer one.
  let searchSeq = 0;
  const search = createAsyncDebouncer(
    async (term: string) => {
      const seq = ++searchSeq;
      if (term.trim().length < 2) {
        results = [];
        return;
      }
      const res = await fetch(`/api/crm/parties?q=${encodeURIComponent(term)}&type=person`);
      if (seq !== searchSeq) return;
      results = res.ok ? ((await res.json()) as PartyResult[]) : [];
      open = true;
    },
    { wait: 200 },
  );
  onDestroy(() => search.cancel());

  function onInput(e: Event) {
    q = (e.currentTarget as HTMLInputElement).value;
    search.run(q);
  }

  function pick(p: PartyResult) {
    partyId = p.id;
    customerName = p.name ?? '—';
    phone = p.phone9;
    q = customerName;
    open = false;
    results = [];
  }

  function clear() {
    partyId = null;
    customerName = null;
    phone = null;
    q = '';
    results = [];
    open = false;
    quickAdd = false;
    quickName = '';
    quickPhone = '';
    quickDni = '';
  }

  // 8 digits typed → registry preview autofills the name (best-effort: the
  // endpoint may be unconfigured or the user may lack crm:edit — stay silent).
  async function onDniInput(e: Event) {
    quickDni = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 8);
    if (quickDni.length !== 8) return;
    try {
      const res = await fetch('/api/crm/dni-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dni: quickDni }),
      });
      if (!res.ok) return;
      const j = (await res.json()) as { found: boolean; name?: string };
      if (j.found && j.name && !quickName.trim()) quickName = j.name;
    } catch {
      /* best-effort */
    }
  }

  async function applyQuick() {
    const name = quickName.trim();
    if (!name || quickBusy) return;
    quickBusy = true;
    try {
      // Real CRM capture: find-or-create the party (dedup on DNI, then phone).
      const res = await fetch('/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          phone: quickPhone.trim() || null,
          docNumber: quickDni.length === 8 ? quickDni : null,
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { party: { id: string; phone9: string | null } };
        partyId = j.party.id;
        phone = j.party.phone9 ?? (quickPhone.trim() || null);
      } else {
        // No permission / offline — keep the sale moving as a ticket-only name.
        partyId = null;
        phone = quickPhone.trim() || null;
      }
    } catch {
      partyId = null;
      phone = quickPhone.trim() || null;
    } finally {
      customerName = name;
      q = name;
      quickAdd = false;
      quickBusy = false;
    }
  }
</script>

<div class="picker">
  <span class="lbl"
    >{m.pos_sell_customer()}{#if required}<span class="req">*</span>{/if}</span
  >

  {#if customerName}
    <div class="chip">
      <span class="cname">{customerName}</span>
      {#if phone}<span class="cphone">{phone}</span>{/if}
      {#if partyId}
        <Badge variant="semantic" value="success" size="sm">{m.pos_customer_saved_crm()}</Badge>
      {:else}
        <span class="ticket-only">{m.pos_customer_ticket_only()}</span>
      {/if}
      <Button type="button" class="clr" title={m.common_remove()} onclick={clear}
        ><X size={13} /></Button
      >
    </div>
  {:else}
    <div class="field">
      <input
        class="inp"
        placeholder={m.pos_sell_customer_ph()}
        value={q}
        oninput={onInput}
        onfocus={() => q && search.run(q)}
      />
      {#if open && results.length}
        <ul class="menu">
          {#each results as p (p.id)}
            <li>
              <Button type="button" onclick={() => pick(p)}>
                <span class="rname">{p.name ?? '—'}</span>
                {#if p.docNumber || p.phone9}
                  <span class="rmeta">{p.docNumber ?? p.phone9}</span>
                {/if}
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if !quickAdd}
      <Button type="button" class="quick-toggle" onclick={() => (quickAdd = true)}>
        <UserPlus size={13} />
        {m.pos_sell_customer_quick_add()}
      </Button>
    {:else}
      <div class="quick-col">
        <div class="quick-row">
          <input
            class="inp"
            inputmode="numeric"
            placeholder={m.pos_sell_customer_dni_ph()}
            value={quickDni}
            oninput={onDniInput}
          />
          <input
            class="inp"
            inputmode="tel"
            placeholder={m.pos_sell_customer_phone_ph()}
            bind:value={quickPhone}
          />
        </div>
        <div class="quick-row">
          <input class="inp" placeholder={m.pos_sell_customer_name_ph()} bind:value={quickName} />
          <Button type="button" class="quick-toggle" disabled={quickBusy} onclick={applyQuick}
            >{m.common_add()}</Button
          >
        </div>
      </div>
    {/if}

    {#if required}
      <span class="hint">{m.pos_customer_required()}</span>
    {/if}
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .lbl {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
  }
  .req {
    color: var(--color-destructive);
    margin-left: var(--space-0-5);
  }
  .field {
    position: relative;
  }
  .inp {
    width: 100%;
    min-height: 2rem;
    padding: var(--space-2) var(--space-2);
    font-size: var(--font-size-body);
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
  }
  .menu {
    position: absolute;
    z-index: var(--layer-navigation);
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    max-height: 12rem;
    overflow: auto;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    background: var(--color-card);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
  }
  .menu li :global([data-part='button']) {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: var(--space-2) var(--space-2);
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    font-size: var(--font-size-body);
    color: var(--color-foreground);
  }
  .menu li :global([data-part='button']):hover {
    background: var(--color-bg3);
  }
  .menu li :global([data-part='button'] > span) {
    width: 100%;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .rname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rmeta {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .chip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
  }
  .cname {
    font-size: var(--font-size-body);
    font-weight: 500;
  }
  .cphone {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .ticket-only {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    font-style: italic;
  }
  .picker :global(.clr) {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
  }
  .picker :global(.clr):hover {
    color: var(--color-destructive);
  }
  .picker :global(.quick-toggle) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--color-accent);
    font-size: var(--font-size-caption);
    cursor: pointer;
    padding: var(--space-1) 0;
  }
  .quick-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .quick-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .hint {
    font-size: var(--font-size-caption);
    color: var(--color-destructive);
  }
</style>
