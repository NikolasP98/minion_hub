<script lang="ts">
  import { Button, iconSizes } from '$lib/components/ui';

  import { onDestroy } from 'svelte';
  import { X, IdCard } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { createAsyncDebouncer } from '$lib/pacer/index.svelte';

  type Party = {
    id: string;
    name: string | null;
    type: string;
    email: string | null;
    docNumber: string | null;
  };

  let {
    value = $bindable(null),
    label = '',
    placeholder = 'Search parties…',
    types = undefined,
    initialName = '',
    docLookup = false,
    onPicked = undefined,
  }: {
    value?: string | null;
    label?: string;
    placeholder?: string;
    /** Comma-separated party types to filter, e.g. "person,company". */
    types?: string | undefined;
    initialName?: string;
    /**
     * Offer registry autofill when the query is a bare DNI (8 digits) or RUC
     * (11 digits): looks the document up (perudevs) and find-or-creates the
     * party with the registry name via POST /api/crm/parties.
     */
    docLookup?: boolean;
    /** Called with the picked party (existing or just created). */
    onPicked?: (party: Party) => void;
  } = $props();

  // svelte-ignore state_referenced_locally -- seed the editable query once from the prop
  let q = $state(initialName);
  let results = $state<Party[]>([]);
  let open = $state(false);

  // A slow response for an earlier keystroke can otherwise land after a
  // faster response for a later one and overwrite it with stale results.
  // AsyncDebouncer only collapses calls still *pending* — it does not
  // guarantee a superseding call wins once two fetches are in flight — so
  // guard the commit with a seq token (same pattern as
  // `runRecordSearch` in $lib/state/ui/command-palette.svelte.ts).
  let searchSeq = 0;
  const search = createAsyncDebouncer(
    async (term: string) => {
      const seq = ++searchSeq;
      const u = new URL('/api/crm/parties', location.origin);
      u.searchParams.set('q', term);
      if (types) u.searchParams.set('type', types);
      const r = await fetch(u);
      if (seq !== searchSeq) return; // a newer search superseded this one
      if (r.ok) {
        results = await r.json();
        open = true;
      }
    },
    { wait: 200 },
  );
  onDestroy(() => search.cancel());

  function onInput(e: Event) {
    q = (e.currentTarget as HTMLInputElement).value;
    value = null; // typing invalidates the prior selection until re-picked
    search.run(q);
  }

  function pick(p: Party) {
    value = p.id;
    q = p.name ?? p.email ?? p.id;
    open = false;
    onPicked?.(p);
  }

  function clear() {
    value = null;
    q = '';
    results = [];
    open = false;
  }

  // ── Registry doc lookup (opt-in) ───────────────────────────────────────────
  const docQuery = $derived(docLookup ? q.trim() : '');
  const docKind = $derived(
    /^\d{8}$/.test(docQuery) ? 'dni' : /^\d{11}$/.test(docQuery) ? 'ruc' : null,
  );
  let docBusy = $state(false);
  let docErr = $state<string | null>(null);

  async function lookupDoc() {
    if (!docKind || docBusy) return;
    docBusy = true;
    docErr = null;
    try {
      // Two literal fetch sites (not a templated path) so the frontend
      // contract scanner can resolve each call to its tracked handler.
      const res =
        docKind === 'dni'
          ? await fetch('/api/crm/dni-lookup', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dni: docQuery }),
            })
          : await fetch('/api/crm/ruc-lookup', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ruc: docQuery }),
            });
      const found = res.ok ? ((await res.json()) as Record<string, unknown>) : null;
      if (!found?.found) {
        docErr = 'not_found';
        return;
      }
      const name = docKind === 'dni' ? String(found.name ?? '') : String(found.legalName ?? '');
      if (!name) {
        docErr = 'not_found';
        return;
      }
      // Find-or-create (dedups on docNumber server-side), then pick it.
      const createRes = await fetch('/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          docType: docKind.toUpperCase(),
          docNumber: docQuery,
          type: docKind === 'ruc' ? 'company' : 'person',
        }),
      });
      if (!createRes.ok) {
        docErr = 'failed';
        return;
      }
      const created = (await createRes.json()) as { party: { id: string; name: string | null } };
      pick({
        id: created.party.id,
        name: created.party.name ?? name,
        type: docKind === 'ruc' ? 'company' : 'person',
        email: null,
        docNumber: docQuery,
      });
    } catch {
      docErr = 'failed';
    } finally {
      docBusy = false;
    }
  }
</script>

<div class="pp">
  {#if label}<span class="lbl">{label}</span>{/if}
  <div class="field">
    <input
      class="in"
      {placeholder}
      value={q}
      oninput={onInput}
      onfocus={() => q && search.run(q)}
      onblur={() => setTimeout(() => (open = false), 150)}
    />
    {#if value || q}
      <Button class="clr" type="button" title="Clear" onclick={clear}><X size={13} /></Button>
    {/if}
    {#if open && (results.length || docKind)}
      <ul class="menu">
        {#each results as p (p.id)}
          <li>
            <Button type="button" onclick={() => pick(p)}>
              <span class="nm">{p.name ?? '(unnamed)'}</span>
              <span class="ty"
                >{p.type}{p.email ? ` · ${p.email}` : p.docNumber ? ` · ${p.docNumber}` : ''}</span
              >
            </Button>
          </li>
        {/each}
        {#if docKind}
          <li>
            <Button type="button" class="doc-row" onclick={lookupDoc} disabled={docBusy}>
              <span class="nm doc-nm">
                <IdCard size={iconSizes.sm} aria-hidden="true" />
                {docBusy ? m.crm_dni_checking() : m.crm_dni_lookup()}
                {docKind.toUpperCase()}
                {docQuery}
              </span>
              {#if docErr}<span class="ty doc-err">{m.crm_dni_error()}</span>{/if}
            </Button>
          </li>
        {/if}
      </ul>
    {/if}
  </div>
</div>

<style>
  .pp {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
  }
  .lbl {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
  }
  .field {
    position: relative;
  }
  .in {
    width: 100%;
    height: 2rem;
    font-size: var(--font-size-body);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    padding: 0 1.8rem 0 0.55rem;
    color: var(--color-foreground);
  }
  .pp :global(.clr) {
    position: absolute;
    right: 0.3rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .menu {
    position: absolute;
    z-index: var(--layer-navigation);
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    max-height: 14rem;
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
    color: var(--color-foreground);
  }
  .menu li :global([data-part='button'] > span) {
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-0);
  }
  .menu li :global([data-part='button']):hover {
    background: var(--color-bg3);
  }
  .nm {
    font-size: var(--font-size-body);
  }
  .ty {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
  }
  .doc-nm {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-accent);
  }
  .doc-err {
    color: var(--color-danger-fg);
  }
  .menu li :global(.doc-row) {
    border-top: 1px solid var(--hairline);
  }
</style>
