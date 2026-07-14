<script lang="ts">
  import { Button } from '$lib/components/ui';

  import { onDestroy } from 'svelte';
  import { X, UserPlus } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { createAsyncDebouncer } from '$lib/pacer/index.svelte';

  interface ContactResult {
    id: string;
    name: string;
  }

  interface Props {
    crmContactId: string | null;
    customerName: string | null;
    required?: boolean;
  }

  let {
    crmContactId = $bindable(null),
    customerName = $bindable(null),
    required = false,
  }: Props = $props();

  let q = $state('');
  let phone = $state<string | null>(null);
  let results = $state<ContactResult[]>([]);
  let open = $state(false);
  let quickAdd = $state(false);
  let quickName = $state('');
  let quickPhone = $state('');

  // Same async-debounce + seq-guard idiom as PartyPicker.svelte — a slow
  // response for an earlier keystroke must not overwrite a newer one.
  let searchSeq = 0;
  const search = createAsyncDebouncer(
    async (term: string) => {
      const seq = ++searchSeq;
      if (term.trim().length < 2) {
        results = [];
        return;
      }
      const res = await fetch(`/api/crm/contacts?search=${encodeURIComponent(term)}&limit=8`);
      if (seq !== searchSeq) return;
      const j = res.ok ? await res.json() : { contacts: [] };
      results = (j.contacts ?? []).map(
        (c: { contact_id: string; display_name: string | null }) => ({
          id: c.contact_id,
          name: c.display_name || '—',
        }),
      );
      open = true;
    },
    { wait: 200 },
  );
  onDestroy(() => search.cancel());

  function onInput(e: Event) {
    q = (e.currentTarget as HTMLInputElement).value;
    search.run(q);
  }

  async function pick(c: ContactResult) {
    crmContactId = c.id;
    customerName = c.name;
    q = c.name;
    open = false;
    results = [];
    phone = null;
    // fetch_from prefill, same endpoint bookings' new-appointment modal uses.
    try {
      const res = await fetch(`/api/crm/contacts/${c.id}/prefill`);
      if (res.ok) {
        const p = await res.json();
        phone = p.phone ?? null;
      }
    } catch {
      /* best-effort */
    }
  }

  function clear() {
    crmContactId = null;
    customerName = null;
    q = '';
    phone = null;
    results = [];
    open = false;
    quickAdd = false;
    quickName = '';
    quickPhone = '';
  }

  function applyQuick() {
    const name = quickName.trim();
    if (!name) return;
    // No server call — the ticket carries customerName as free text; party
    // linkage is a follow-up (per brief). Phone is display-only here.
    customerName = name;
    phone = quickPhone.trim() || null;
    crmContactId = null;
    quickAdd = false;
    q = name;
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
          {#each results as c (c.id)}
            <li><Button type="button" onclick={() => pick(c)}>{c.name}</Button></li>
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
      <div class="quick-row">
        <input class="inp" placeholder={m.pos_sell_customer_name_ph()} bind:value={quickName} />
        <input class="inp" placeholder={m.pos_sell_customer_phone_ph()} bind:value={quickPhone} />
        <Button type="button" class="quick-toggle" onclick={applyQuick}>{m.common_add()}</Button>
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
  .chip {
    display: flex;
    align-items: center;
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
