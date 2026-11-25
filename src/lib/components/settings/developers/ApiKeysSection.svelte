<script lang="ts">
  import { Copy, KeySquare, Plus } from 'lucide-svelte';
  import { page } from '$app/state';
  import { invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import {
    iconSizes,
    Badge,
    Button,
    Card,
    EmptyState,
    Input,
    Toggle,
    Tooltip,
  } from '$lib/components/ui';
  import { ConfirmDialog, Dialog, FormField } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { ApiError } from '$lib/api/fetch-json';
  import { formatDate } from '$lib/utils/format';
  import { toastSuccess } from '$lib/state/ui/toast.svelte';
  import type { ApiKeyRow } from '$lib/types/api-keys';

  let { keys, isOwner = false }: { keys: ApiKeyRow[]; isOwner?: boolean } = $props();

  const NAME_MAX = 60;
  const when = (iso: string | null) =>
    iso
      ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' })
      : m.settings_developers_never();

  // A 403 always names the role; other refusals name their own fix.
  function failure(e: unknown, fallback: string): string {
    if (!(e instanceof ApiError)) return fallback;
    if (e.message === 'owner_required') return m.settings_developers_locks_owner_required();
    if (e.status === 403) return m.settings_developers_forbidden();
    if (e.message === 'invalid_name') return m.settings_developers_invalid_name();
    if (e.message === 'invalid_scope') return m.settings_developers_create_failed();
    if (e.message === 'limit_reached') return m.settings_developers_limit_reached();
    return fallback;
  }

  // ── Create, then reveal once ─────────────────────────────────────────────
  let createOpen = $state(false);
  let name = $state('');
  let sandboxScope = $state(false);
  let locksScope = $state(false);
  let creating = $state(false);
  let createError = $state<string | null>(null);
  /** The key text, held only while the reveal dialog is open. */
  let revealed = $state<string | null>(null);

  function openCreate() {
    name = '';
    sandboxScope = false;
    locksScope = false;
    createError = null;
    revealed = null;
    createOpen = true;
  }

  function closeCreate() {
    createOpen = false;
    revealed = null;
  }

  async function create() {
    if (creating || !name.trim()) return;
    creating = true;
    createError = null;
    try {
      const created = await jsonMutation<ApiKeyRow & { key: string }>({
        input: '/api/settings/api-keys',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            scopes: [...(sandboxScope ? ['sandbox'] : []), ...(locksScope ? ['locks'] : [])],
          }),
        },
        onSuccess: () => invalidate('settings:developers'),
      });
      revealed = created.key;
    } catch (e) {
      createError = failure(e, m.settings_developers_create_failed());
    } finally {
      creating = false;
    }
  }

  async function copyKey() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      toastSuccess(m.settings_developers_copied());
    } catch {
      /* clipboard unavailable: the key stays selectable on screen */
    }
  }

  // ── Revoke ───────────────────────────────────────────────────────────────
  let revoking = $state<ApiKeyRow | null>(null);
  let revokeOpen = $state(false);
  let revokeError = $state(m.settings_developers_revoke_failed());

  function askRevoke(row: ApiKeyRow) {
    revoking = row;
    revokeError = m.settings_developers_revoke_failed();
    revokeOpen = true;
  }

  async function revoke() {
    if (!revoking) return;
    try {
      await jsonMutation({
        input: `/api/settings/api-keys/${encodeURIComponent(revoking.id)}`,
        init: { method: 'DELETE' },
        onSuccess: () => invalidate('settings:developers'),
      });
      toastSuccess(m.settings_developers_revoked_toast());
    } catch (e) {
      revokeError = failure(e, m.settings_developers_revoke_failed());
      throw e;
    }
  }

  // ── Table ────────────────────────────────────────────────────────────────
  const columns: DataColumn<ApiKeyRow>[] = [
    { key: 'name', label: m.settings_developers_col_name(), accessor: (r) => r.name, fill: true },
    {
      key: 'prefix',
      label: m.settings_developers_col_key(),
      custom: true,
      accessor: (r) => r.prefix,
      sortable: false,
      width: 260,
    },
    {
      key: 'createdAt',
      label: m.settings_developers_col_created(),
      accessor: (r) => r.createdAt,
      custom: true,
      width: 170,
    },
    {
      key: 'createdByName',
      label: m.settings_developers_col_created_by(),
      accessor: (r) => r.createdByName ?? '—',
      width: 160,
    },
    {
      key: 'lastUsedAt',
      label: m.settings_developers_col_last_used(),
      accessor: (r) => r.lastUsedAt ?? '',
      custom: true,
      width: 170,
    },
    {
      key: 'status',
      label: m.settings_developers_col_status(),
      accessor: (r) => (r.revokedAt ? 1 : 0),
      custom: true,
      width: 240,
    },
  ];

  const example = $derived(
    [
      `curl -X POST ${page.url.origin}/api/doors/public/<slug>/submit \\`,
      `  -H 'content-type: application/json' \\`,
      `  -H 'authorization: Bearer mk_…' \\`,
      `  -d '{"values":{"nombre":"…"},"consent":true}'`,
    ].join('\n'),
  );
</script>

{#snippet keyCell(r: ApiKeyRow)}
  <span class="mono">mk_{r.prefix}_…</span>
  {#if r.scopes.includes('sandbox')}
    <Badge size="sm">{m.settings_developers_scope_sandbox()}</Badge>
  {/if}
  {#if r.scopes.includes('locks')}
    <Badge size="sm">{m.settings_developers_scope_locks()}</Badge>
  {/if}
{/snippet}
{#snippet createdCell(r: ApiKeyRow)}{when(r.createdAt)}{/snippet}
{#snippet lastUsedCell(r: ApiKeyRow)}{when(r.lastUsedAt)}{/snippet}
{#snippet statusCell(r: ApiKeyRow)}
  {#if r.revokedAt}
    <!-- When and by whom sits in a tooltip: inline it overflowed the column. -->
    <Tooltip
      label={r.revokedByName
        ? m.settings_developers_revoked_by({ date: when(r.revokedAt), name: r.revokedByName })
        : when(r.revokedAt)}
    >
      <Badge size="sm">{m.settings_developers_status_revoked()}</Badge>
    </Tooltip>
  {:else}
    <span class="status">
      <Badge variant="semantic" value="success" size="sm"
        >{m.settings_developers_status_active()}</Badge
      >
      <Button variant="ghost" size="xs" onclick={() => askRevoke(r)}>
        {m.settings_developers_revoke()}
      </Button>
    </span>
  {/if}
{/snippet}
{#snippet tableEmpty()}
  <EmptyState
    icon={KeySquare}
    title={m.settings_developers_empty_title()}
    description={m.settings_developers_empty_desc()}
    compact
  />
{/snippet}

<section class="section" aria-labelledby="api-keys-title">
  <div class="section-head">
    <h2 id="api-keys-title" class="t-title">{m.settings_developers_keys_title()}</h2>
    <Button size="sm" onclick={openCreate}>
      <Plus size={iconSizes.sm} />
      {m.settings_developers_new()}
    </Button>
  </div>
  <Card padding="none">
    <DataTable
      variant="plain"
      data={keys}
      {columns}
      getRowId={(r) => r.id}
      empty={tableEmpty}
      cells={{
        prefix: keyCell,
        createdAt: createdCell,
        lastUsedAt: lastUsedCell,
        status: statusCell,
      }}
    />
  </Card>
</section>

<section class="section" aria-labelledby="api-keys-example-title">
  <h2 id="api-keys-example-title" class="t-title">{m.settings_developers_example_title()}</h2>
  <p class="t-body muted">{m.settings_developers_example_hint()}</p>
  <pre class="code">{example}</pre>
</section>

<Dialog
  open={createOpen}
  labelledBy="api-key-create-title"
  size="sm"
  dirty={!revealed && !!name.trim()}
  onclose={closeCreate}
>
  {#snippet header()}
    <h2 id="api-key-create-title" class="t-title">
      {revealed ? m.settings_developers_reveal_title() : m.settings_developers_new()}
    </h2>
  {/snippet}
  {#if revealed}
    <div class="form">
      <p class="t-body warning" role="status">{m.settings_developers_reveal_warning()}</p>
      <pre class="code secret">{revealed}</pre>
    </div>
  {:else}
    <div class="form">
      <FormField
        label={m.settings_developers_name_label()}
        helper={m.settings_developers_name_hint()}
        required
        disabled={creating}
      >
        {#snippet children(p)}<Input {...p} bind:value={name} maxlength={NAME_MAX} />{/snippet}
      </FormField>
      <Toggle
        bind:checked={sandboxScope}
        label={m.settings_developers_scope_sandbox()}
        description={m.settings_developers_scope_sandbox_hint()}
        disabled={creating}
      />
      <Toggle
        bind:checked={locksScope}
        label={m.settings_developers_scope_locks()}
        description={isOwner
          ? m.settings_developers_scope_locks_hint()
          : m.settings_developers_locks_owner_required()}
        disabled={creating || !isOwner}
      />
      {#if createError}<p class="error" role="alert">{createError}</p>{/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if revealed}
      <Button variant="ghost" onclick={copyKey}>
        <Copy size={iconSizes.sm} />
        {m.settings_developers_copy()}
      </Button>
      <Button onclick={closeCreate}>{m.settings_developers_done()}</Button>
    {:else}
      <Button variant="ghost" onclick={closeCreate} disabled={creating}>
        {m.common_cancel()}
      </Button>
      <Button onclick={create} loading={creating} disabled={!name.trim()}>
        {m.settings_developers_create_submit()}
      </Button>
    {/if}
  {/snippet}
</Dialog>

<ConfirmDialog
  bind:open={revokeOpen}
  title={m.settings_developers_revoke_title({ name: revoking?.name ?? '' })}
  message={m.settings_developers_revoke_message()}
  confirmLabel={m.settings_developers_revoke()}
  failureMessage={revokeError}
  tone="danger"
  onconfirm={revoke}
/>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .section + .section {
    margin-top: var(--space-section);
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .mono,
  .code {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
  }
  .mono {
    margin-inline-end: var(--space-2);
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .code {
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .secret {
    user-select: all;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .warning {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-md);
    color: var(--color-warning-fg);
    background: var(--color-warning-surface);
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
