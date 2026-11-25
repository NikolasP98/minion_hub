<script lang="ts">
  import { Webhook } from 'lucide-svelte';
  import { page } from '$app/state';
  import { invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Button, Card, EmptyState, Input } from '$lib/components/ui';
  import { Dialog, FormField } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { ApiError } from '$lib/api/fetch-json';
  import { formatDate } from '$lib/utils/format';
  import { toastSuccess } from '$lib/state/ui/toast.svelte';
  import { lockRefusal } from '$lib/components/stock/lock-reasons';
  import type { ExternalLockRow } from '$server/services/record-locks.service';

  let {
    locks,
    isOwner,
    hasLocksKey = false,
  }: { locks: ExternalLockRow[]; isOwner: boolean; hasLocksKey?: boolean } = $props();

  /** One row per call: locks set by ids in one request share label, key and instant. */
  type LockGroup = ExternalLockRow & { ids: string[] };
  const groups = $derived.by(() => {
    const out: LockGroup[] = [];
    const byCall = new Map<string, LockGroup>();
    for (const l of locks) {
      const call = l.recordId ? `${l.label}|${l.apiKeyId ?? ''}|${l.createdAt}` : null;
      const hit = call ? byCall.get(call) : undefined;
      if (hit) hit.ids.push(l.id);
      else {
        const g = { ...l, ids: [l.id] };
        out.push(g);
        if (call) byCall.set(call, g);
      }
    }
    return out;
  });

  const dayMonth = (value: string, timeZone?: string) =>
    formatDate(value, { day: '2-digit', month: '2-digit', ...(timeZone ? { timeZone } : {}) });
  const scope = (l: LockGroup) =>
    l.upTo
      ? m.record_locks_external_scope_date({ upTo: dayMonth(`${l.upTo}T00:00:00Z`, 'UTC') })
      : l.ids.length > 1
        ? m.record_locks_external_scope_records({ n: l.ids.length })
        : m.record_locks_external_scope_record();

  // ── Lift (owner) ─────────────────────────────────────────────────────────
  let lifting = $state<LockGroup | null>(null);
  let open = $state(false);
  let reason = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  function ask(l: LockGroup) {
    lifting = l;
    reason = '';
    error = null;
    open = true;
  }

  async function lift() {
    if (!lifting || busy || !reason.trim()) return;
    busy = true;
    error = null;
    try {
      // TODO(handoff): a grouped row lifts its locks one request each and stops at the first refusal, so a
      // mid-way failure leaves part of the call lifted; a batch lift route (ids in one transaction) would make it atomic.
      // A grouped row lifts every lock of its call, one request each (the route lifts one lock).
      for (const id of lifting.ids)
        await jsonMutation({
          input: `/api/settings/record-locks/locks/${encodeURIComponent(id)}/lift`,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason: reason.trim() }),
          },
          onSuccess: () => invalidate('settings:record-locks'),
        });
      toastSuccess(m.record_locks_external_lifted());
      open = false;
    } catch (e) {
      const code =
        e instanceof ApiError ? (e.details as { code?: string } | undefined)?.code : undefined;
      error = lockRefusal(code);
    } finally {
      busy = false;
    }
  }

  const columns: DataColumn<LockGroup>[] = [
    {
      key: 'label',
      label: m.record_locks_external_col_label(),
      accessor: (r) => r.label,
      fill: true,
    },
    {
      key: 'scope',
      label: m.record_locks_external_col_scope(),
      accessor: (r) => scope(r),
      custom: true,
      width: 200,
    },
    {
      key: 'actorName',
      label: m.record_locks_external_col_key(),
      accessor: (r) => r.actorName ?? '—',
      width: 180,
    },
    {
      key: 'createdAt',
      label: m.record_locks_external_col_date(),
      accessor: (r) => r.createdAt,
      custom: true,
      width: 110,
    },
    { key: 'actions', label: '', accessor: () => '', custom: true, sortable: false, width: 100 },
  ];

  const example = $derived(
    [
      `curl -X POST ${page.url.origin}/api/hooks/record-locks \\`,
      `  -H 'content-type: application/json' \\`,
      `  -H 'authorization: Bearer mk_…' \\`,
      `  -d '{"action":"lock","label":"Contabilidad","upTo":"2026-10-31"}'`,
    ].join('\n'),
  );
</script>

{#snippet scopeCell(r: LockGroup)}
  {#if r.ids.length === 1 && r.recordId && r.recordLabel}
    <a class="card-link" href={`/stock/entries/${r.recordId}`}>{r.recordLabel}</a>
  {:else}{scope(r)}{/if}
{/snippet}
{#snippet dateCell(r: LockGroup)}<span class="muted">{dayMonth(r.createdAt)}</span>{/snippet}
{#snippet actionsCell(r: LockGroup)}
  {#if isOwner}
    <Button variant="ghost" size="xs" onclick={() => ask(r)}
      >{m.record_locks_external_lift()}</Button
    >
  {/if}
{/snippet}
{#snippet tableEmpty()}
  <EmptyState
    icon={Webhook}
    title={m.record_locks_external_empty()}
    description={m.record_locks_external_empty_hint()}
    compact
  />
{/snippet}

<section class="section" aria-labelledby="record-locks-external-title">
  <h2 id="record-locks-external-title" class="t-title">{m.record_locks_external_title()}</h2>
  <Card padding="none">
    <DataTable
      variant="plain"
      data={groups}
      {columns}
      getRowId={(r) => r.id}
      empty={tableEmpty}
      cells={{ scope: scopeCell, createdAt: dateCell, actions: actionsCell }}
    />
  </Card>
  {#if hasLocksKey}
    <h3 class="t-label">{m.record_locks_external_howto_title()}</h3>
    <pre class="code">{example}</pre>
  {/if}
</section>

<Dialog
  {open}
  labelledBy="record-locks-lift-title"
  size="sm"
  dirty={!busy && !!reason.trim()}
  onclose={() => (open = false)}
>
  {#snippet header()}
    <h2 id="record-locks-lift-title" class="t-title">
      {m.record_locks_external_lift_title({ label: lifting?.label ?? '' })}
    </h2>
  {/snippet}
  <div class="form">
    <p class="t-body">{m.record_locks_external_lift_message()}</p>
    <FormField label={m.record_locks_external_lift_reason()} required disabled={busy}>
      {#snippet children(p)}<Input {...p} bind:value={reason} maxlength={1000} />{/snippet}
    </FormField>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)} disabled={busy}>
      {m.common_cancel()}
    </Button>
    <Button onclick={lift} loading={busy} disabled={!reason.trim()}>
      {m.record_locks_external_lift_confirm()}
    </Button>
  {/snippet}
</Dialog>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-section);
  }
  .section h3 {
    margin: 0;
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .card-link {
    color: var(--color-accent);
    text-decoration: none;
  }
  .card-link:hover,
  .card-link:focus-visible {
    text-decoration: underline;
  }
  .code {
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
  }
</style>
