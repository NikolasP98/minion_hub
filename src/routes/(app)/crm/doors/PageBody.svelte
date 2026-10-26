<script lang="ts">
  import type { PageData } from './$types';
  import type { DatasetDenied } from '$lib/permissions';
  import { DoorOpen, Plus, Copy, ExternalLink } from 'lucide-svelte';
  import { goto, invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import {
    iconSizes,
    Badge,
    Button,
    EmptyState,
    Input,
    PageHeader,
    SegmentedControl,
    Select,
    Toggle,
  } from '$lib/components/ui';
  import { Dialog, FormField, PageBody, PageShell } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { createOptimistic } from '$lib/utils/optimistic';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { doorKindLabel } from '$lib/doors/labels';
  import type { DoorKind, DoorListRow } from '$lib/doors/types';

  let { data }: { data: Exclude<PageData['crm'], DatasetDenied> } = $props();
  type Row = DoorListRow;

  const canManageDoors = $derived(canAct('crm', 'manage'));
  const canManageLinks = $derived(canAct('scheduling', 'manage'));
  const canToggle = (row: Row) => (row.kind === 'book' ? canManageLinks : canManageDoors);

  // ── On/off: optimistic + pending, revert + toast on failure ─────────────
  const activeOpt = createOptimistic<boolean>();

  async function setActive(row: Row, next: boolean) {
    let forbidden = false;
    const ok = await activeOpt.run(row.key, next, async () => {
      // The booking-link PATCH replaces every field, so it gets the full row back.
      const res =
        row.kind === 'book'
          ? await fetch(`/api/scheduling/links/${encodeURIComponent(row.id)}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                slug: row.slug,
                title: row.title,
                description: row.link?.description ?? null,
                eventTypeIds: row.link?.eventTypeIds ?? [],
                resourceId: row.link?.resourceId ?? null,
                expiresAt: row.link?.expiresAt ?? null,
                active: next,
              }),
            })
          : await fetch(`/api/crm/doors/${encodeURIComponent(row.id)}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ active: next }),
            });
      if (!res.ok) {
        forbidden = res.status === 403;
        return false;
      }
      await invalidate('crm:doors');
      return true;
    });
    if (ok) return;
    if (!forbidden) toastError(m.doors_toggle_error());
    else toastError(row.kind === 'book' ? m.doors_no_permission_links() : m.doors_no_permission());
  }

  // ── Public URLs ───────────────────────────────────────────────────────────
  function publicUrl(row: Row): string {
    // Unprefixed like scheduling/links: the router adds the visitor's locale (localizePath here doubled it to /es/es/).
    return `${data.origin}/${row.kind === 'book' ? 'book' : 'd'}/${row.slug}`;
  }
  async function copy(row: Row) {
    try {
      await navigator.clipboard.writeText(publicUrl(row));
      toastSuccess(m.doors_copied());
    } catch {
      /* clipboard unavailable */
    }
  }

  // ── Range ─────────────────────────────────────────────────────────────────
  const rangeItems = [7, 30, 90].map((days) => ({
    value: String(days),
    label: m.doors_range_days({ days }),
  }));
  function pickRange(value: string) {
    void goto(`?days=${value}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  // ── Create ────────────────────────────────────────────────────────────────
  const slugify = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);

  let createOpen = $state(false);
  let newKind = $state<string>('');
  let newTitle = $state('');
  let newSlug = $state('');
  let slugTouched = $state(false);
  let creating = $state(false);
  let createError = $state<string | null>(null);
  const shownSlug = $derived(slugTouched ? newSlug : slugify(newTitle));
  const kindOptions = $derived(
    data.kinds.map((kind) => ({ value: kind, label: doorKindLabel(kind) })),
  );

  function openCreate() {
    newKind = data.kinds[0] ?? '';
    newTitle = '';
    newSlug = '';
    slugTouched = false;
    createError = null;
    createOpen = true;
  }

  async function create() {
    if (!canManageDoors || creating || !newKind || !newTitle.trim() || !shownSlug) return;
    creating = true;
    createError = null;
    try {
      const res = await fetch('/api/crm/doors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: newKind as DoorKind,
          slug: shownSlug,
          title: newTitle.trim(),
        }),
      });
      if (res.ok) {
        const { door } = (await res.json()) as { door: { id: string } };
        createOpen = false;
        await goto(`/crm/doors/${door.id}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      createError =
        res.status === 403
          ? m.doors_no_permission()
          : res.status === 409
            ? m.doors_slug_taken()
            : res.status === 400
              ? body.error === 'unknown_kind'
                ? m.doors_unknown_kind()
                : m.doors_invalid()
              : m.doors_create_error();
    } catch {
      createError = m.doors_create_error();
    } finally {
      creating = false;
    }
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  const count = (key: keyof Row, label: string, width = 88): DataColumn<Row> => ({
    key,
    label,
    accessor: (r) => r[key] as number,
    numeric: true,
    align: 'right',
    width,
  });
  const columns = $derived<DataColumn<Row>[]>([
    {
      key: 'title',
      label: m.doors_col_door(),
      custom: true,
      accessor: (r) => r.title,
      fill: true,
      width: 140,
    },
    {
      key: 'kind',
      label: m.doors_col_kind(),
      custom: true,
      accessor: (r) => doorKindLabel(r.kind),
      width: 150,
    },
    {
      key: 'link',
      label: m.doors_col_link(),
      custom: true,
      accessor: (r) => r.slug,
      sortable: false,
      width: 200,
    },
    {
      key: 'active',
      label: m.doors_col_on(),
      custom: true,
      accessor: (r) => (r.active ? 1 : 0),
      width: 72,
    },
    count('views', m.doors_col_views()),
    count('submissions', m.doors_col_submissions(), 130),
    count('clicks', m.doors_col_clicks()),
    count('contacts', m.doors_col_contacts(), 130),
    count('customers', m.doors_col_customers()),
  ]);
</script>

<svelte:head><title>{m.doors_title()} · CRM</title></svelte:head>

{#snippet titleCell(r: Row)}
  <a
    class="record-link"
    href={r.kind === 'book' ? '/scheduling/links' : `/crm/doors/${r.id}`}
    onclick={(e) => e.stopPropagation()}>{r.title}</a
  >
{/snippet}
{#snippet kindCell(r: Row)}
  <Badge variant="neutral" size="sm">{doorKindLabel(r.kind)}</Badge>
{/snippet}
{#snippet linkCell(r: Row)}
  <span class="link-cell">
    <span class="slug">/{r.kind === 'book' ? 'book' : 'd'}/{r.slug}</span>
    <Button
      variant="ghost"
      shape="icon"
      size="xs"
      onclick={() => copy(r)}
      aria-label={m.doors_copy()}
    >
      <Copy size={iconSizes.sm} />
    </Button>
    <a class="open" href={publicUrl(r)} target="_blank" rel="noopener" aria-label={m.doors_open()}>
      <ExternalLink size={iconSizes.sm} />
    </a>
  </span>
{/snippet}
{#snippet activeCell(r: Row)}
  <Toggle
    size="sm"
    checked={activeOpt.get(r.key, r.active)}
    disabled={!canToggle(r)}
    pending={activeOpt.isPending(r.key)}
    ariaLabel={m.doors_toggle_on({ title: r.title })}
    onchange={(checked) => setActive(r, checked)}
  />
{/snippet}
{#snippet tableEmpty()}
  <EmptyState
    icon={DoorOpen}
    title={m.doors_empty_title()}
    description={m.doors_empty_desc()}
    compact
  />
{/snippet}

<PageShell archetype="collection" scroll="none" labelledBy="crm-doors-title">
  <PageHeader titleId="crm-doors-title" title={m.doors_title()} subtitle={m.doors_subtitle()}>
    {#snippet leading()}
      <DoorOpen size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
    {#snippet secondaryActions()}
      <SegmentedControl
        items={rangeItems}
        value={String(data.range.days ?? 30)}
        aria-label={m.doors_range_label()}
        onValueChange={pickRange}
      />
    {/snippet}
    {#snippet primaryActions()}
      {#if canManageDoors}
        <Button size="sm" onclick={openCreate}>
          <Plus size={iconSizes.sm} />
          {m.doors_new()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody padding="none" scroll="none">
    <DataTable
      class="flex-1 min-h-0"
      {columns}
      data={data.doors}
      getRowId={(r) => r.key}
      searchFields={(r) => `${r.title} ${r.slug}`}
      storageKey="crm-doors"
      empty={tableEmpty}
      cells={{ title: titleCell, kind: kindCell, link: linkCell, active: activeCell }}
    />
  </PageBody>
  <p class="hint t-caption">{m.doors_counts_hint()}</p>
</PageShell>

<Dialog
  open={createOpen}
  labelledBy="crm-door-create-title"
  size="sm"
  dirty={!!newTitle.trim()}
  onclose={() => (createOpen = false)}
>
  {#snippet header()}
    <h2 id="crm-door-create-title" class="t-title">{m.doors_new()}</h2>
  {/snippet}
  {#if data.kinds.length === 0}
    <p class="t-body muted">{m.doors_no_kinds()}</p>
  {:else}
    <div class="create-form">
      <Select
        label={m.doors_field_kind()}
        options={kindOptions}
        value={newKind}
        onchange={(value) => (newKind = String(value))}
        disabled={creating}
      />
      <FormField label={m.doors_field_title()} required disabled={creating}>
        {#snippet children(p)}<Input {...p} bind:value={newTitle} maxlength={200} />{/snippet}
      </FormField>
      <FormField
        label={m.doors_field_slug()}
        helper={m.doors_slug_hint()}
        required
        disabled={creating}
      >
        {#snippet children(p)}<Input
            {...p}
            value={shownSlug}
            maxlength={63}
            oninput={(e: Event) => {
              slugTouched = true;
              newSlug = slugify((e.currentTarget as HTMLInputElement).value);
            }}
          />{/snippet}
      </FormField>
      {#if createError}
        <p class="create-error" role="alert">{createError}</p>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (createOpen = false)} disabled={creating}>
      {m.common_cancel()}
    </Button>
    <Button
      onclick={create}
      loading={creating}
      disabled={!newKind || !newTitle.trim() || shownSlug.length < 3}
    >
      {m.doors_create_submit()}
    </Button>
  {/snippet}
</Dialog>

<style>
  .record-link {
    color: var(--color-accent);
    text-decoration: none;
  }
  .record-link:hover {
    text-decoration: underline;
  }
  .link-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .slug {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .open {
    display: inline-flex;
    align-items: center;
    color: var(--color-text-secondary);
  }
  .open:hover {
    color: var(--color-accent);
  }
  .hint {
    padding: var(--space-2) var(--space-page-gutter);
    color: var(--color-text-tertiary);
    border-top: 1px solid var(--color-border-subtle);
  }
  .create-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .create-error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
  }
</style>
