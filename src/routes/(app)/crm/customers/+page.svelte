<script lang="ts">
  import type { PageData } from './$types';
  import { goto } from '$lib/navigation';
  import { invalidate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import {
    Contact,
    RefreshCw,
    ArrowUp,
    ArrowDown,
    X,
    CircleCheck,
    Circle,
    Megaphone,
    Sprout,
  } from 'lucide-svelte';
  import { PageHeader, Button, Modal, Select, iconSizes } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import ScoreCell from '$lib/components/crm/ScoreCell.svelte';
  import StagePill from '$lib/components/crm/StagePill.svelte';
  import FunnelStagePill from '$lib/components/crm/FunnelStagePill.svelte';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import Highlight from '$lib/components/crm/Highlight.svelte';
  import { relativeTime, contactLabel, identityValue } from '$lib/components/crm/crm-format';
  import { stageLabel, funnelStageLabel } from '$lib/components/crm/crm-i18n';
  import {
    FUNNEL_ORDER,
    effectiveFunnelStage,
    maxFunnelStage,
    financeFloorStage,
  } from '$lib/components/crm/crm-funnel';
  import { metaLabel, metaDisplay } from '$lib/components/crm/crm-meta';
  import { canAct } from '$lib/access/can.svelte';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn, ServerQuery } from '$lib/components/data-table/DataTable.svelte';
  import CrmMergeResolver from '$lib/components/crm/CrmMergeResolver.svelte';
  import {
    applyContactMerge,
    type MergeField,
    type MergeResolution,
  } from '$lib/components/crm/crm-merge';

  let { data }: { data: PageData } = $props();
  const tags = $derived(data.tags);
  type Row = (typeof data.contacts)[number];

  // ── Server-mode rows (spec 2026-08-13 §S5) ─────────────────────────────────
  // `data.contacts` is ONE page resolved by the server load from the URL;
  // interactions refetch through GET /api/crm/contacts (same contract). After
  // `invalidate('crm:contacts')` the load re-runs with the synced URL, and this
  // resync keeps local rows consistent with it.
  // svelte-ignore state_referenced_locally
  let rows = $state<Row[]>(data.contacts);
  // svelte-ignore state_referenced_locally
  let total = $state<number>(data.total);
  let loading = $state(false);
  $effect(() => {
    rows = data.contacts;
    total = data.total;
  });

  // Personal orgs de-emphasize the sales funnel (WP2) — no funnel column.
  const isPersonal = $derived(page.data.activeOrgKind === 'personal');

  // ── Finance bridge (present only when CRM + Finances are both enabled) ──────
  type ContactFin = {
    revenue: number;
    invoices: number;
    lastPurchaseAt: string | null;
    purchased: boolean;
    reservedOnly: boolean;
    loyal: boolean;
  };
  const finOf = (c: Row) => (c as { finance?: ContactFin | null }).finance ?? null;
  const reservedOnly = (c: Row) => finOf(c)?.reservedOnly === true;
  // Effective funnel stage = chat-derived stage advanced by the finance floor.
  const funnelOf = (c: Row) =>
    maxFunnelStage(
      effectiveFunnelStage(c.custom_fields, { inbound: c.inbound_msgs }),
      financeFloorStage(finOf(c)),
    );

  // ── Filter options ──────────────────────────────────────────────────────────
  // Org-wide distinct custom_fields keys from the server (`getMetaKeys`) — the
  // page only ships 100 rows now, so scanning them would miss most keys.
  const metaKeys = $derived(data.metaKeys);
  const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
  const stageOptions = STAGES.map((s) => ({ value: s, label: stageLabel(s) }));
  const funnelOptions = FUNNEL_ORDER.map((id) => ({ value: id, label: funnelStageLabel(id) }));
  const verifiedOptions = [
    { value: '1', label: m.crm_verified_filter_yes() },
    { value: '0', label: m.crm_verified_filter_no() },
  ];
  const sexOptions = [
    { value: 'M', label: m.crm_sex_m() },
    { value: 'F', label: m.crm_sex_f() },
  ];
  // Meta lead attribution (IG today): 'ad' | 'organic'; anything else = untracked.
  const originOptions = [
    { value: 'ad', label: m.crm_origin_ad() },
    { value: 'organic', label: m.crm_origin_organic() },
    { value: '', label: m.crm_origin_untracked() },
  ];
  const originOf = (c: Row) =>
    c.lead_origin === 'ad' || c.lead_origin === 'organic' ? c.lead_origin : '';
  const originLabel = (c: Row) =>
    originOf(c) === 'ad'
      ? m.crm_origin_ad()
      : originOf(c) === 'organic'
        ? m.crm_origin_organic()
        : '';
  // Canonical M/F from the DNI registry localizes here; fall back to the legacy
  // Spanish custom_fields.sexo for rows that were never DNI-verified.
  const sexLabel = (c: Row) =>
    c.sex === 'M'
      ? m.crm_sex_m()
      : c.sex === 'F'
        ? m.crm_sex_f()
        : ((c.custom_fields?.sexo as string | undefined) ?? '');
  // TODO(handoff): options derive from the CURRENT page's rows (plus any
  // URL-selected values), so a channel absent from this page can't be picked
  // until it scrolls into a page. S6 should source the org's channel list
  // server-side (see specs/2026-08-13-crm-customers-server-pagination-spec §S6).
  const channelOptions = $derived.by(() => {
    const s = new Set<string>(qpArr('channel'));
    for (const c of rows) for (const ch of c.channels ?? []) s.add(ch);
    return [...s]
      .sort()
      .map((ch) => ({ value: ch, label: ch.charAt(0).toUpperCase() + ch.slice(1) }));
  });

  // ── Page-owned filters (tag / reserved / awaiting / score / temp) ──────────
  // Header enum filters (stage/funnel/channel) are seeded into DataTable via
  // `initialFilters`; these toggles/chips pre-filter the data set instead.
  const qp = page.url.searchParams;
  const qpArr = (k: string) =>
    (qp.get(k) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  let tagId = $state('');
  let reservedFilter = $state(qp.get('reserved') === '1');
  let awaitingFilter = $state(qp.get('awaiting') === '1');
  let scoreMin = $state<number | null>(qp.has('scoreMin') ? Number(qp.get('scoreMin')) : null);
  let scoreMax = $state<number | null>(qp.has('scoreMax') ? Number(qp.get('scoreMax')) : null);
  let tempFilter = $state<string>(qp.get('temp') ?? '');
  const scoreActive = $derived(scoreMin != null || scoreMax != null);
  const initialFilters = {
    stage: qpArr('stage'),
    funnel: qpArr('funnel'),
    channel: qpArr('channel'),
    origin: qpArr('origin').map((v) => (v === 'none' ? '' : v)),
    verified: qpArr('verified'),
    sex: qpArr('sex'),
  };

  // ── Server request manager (spec 2026-08-13 §S5) ───────────────────────────
  // DataTable server mode reports every search/sort/filter/page interaction
  // through `onQuery`; the page-owned toggles above fold into the same request.
  // The URL mirrors the full state (shallow `replaceState` — no load re-run),
  // so reload/share restores it and `invalidate('crm:contacts')` refetches the
  // same view through the server load.
  const SORT_MAP: Record<string, string> = {
    score: 'score',
    recent: 'recent',
    name: 'name',
    revenue: 'revenue',
    msgs: 'frequency',
  };
  let lastQuery: ServerQuery = {
    search: qp.get('q') ?? '',
    sort: qp.get('sort') ? { key: qp.get('sort')!, dir: 'desc' } : null,
    filters: Object.fromEntries(
      Object.entries(initialFilters)
        .filter(([, v]) => v.length > 0)
        .map(([k, v]) => [k, v.join(',')]),
    ),
    page: Math.max(1, Number(qp.get('page') ?? 1)),
    // svelte-ignore state_referenced_locally — pageSize is load-constant
    pageSize: data.pageSize,
  };
  let reqSeq = 0;
  function buildParams(q: ServerQuery): URLSearchParams {
    const p = new URLSearchParams();
    if (q.search) p.set('q', q.search);
    const serverSort = q.sort ? SORT_MAP[q.sort.key] : undefined;
    if (serverSort) {
      p.set('sort', serverSort);
      if (q.sort?.dir) p.set('dir', q.sort.dir);
    }
    for (const [k, v] of Object.entries(q.filters)) {
      // Column filter keys → URL/API names. `origin` sends 'none' for the
      // untracked option ('' in the column filter's value domain).
      if (k === 'origin') p.set('origin', v.replace(/(^|,)(?=,|$)/g, '$1none'));
      else p.set(k, v);
    }
    // Infinite scroll: `page` feeds the API offset only — the URL always
    // restores from the top, so it never carries a page param.
    if (tagId) p.set('tag', tagId);
    if (reservedFilter) p.set('reserved', '1');
    if (awaitingFilter) p.set('awaiting', '1');
    if (scoreMin != null) p.set('scoreMin', String(scoreMin));
    if (scoreMax != null) p.set('scoreMax', String(scoreMax));
    if (tempFilter) p.set('temp', tempFilter);
    return p;
  }
  /** URL params (page state) → API params for GET /api/crm/contacts. */
  function toApiParams(p: URLSearchParams): URLSearchParams {
    const api = new URLSearchParams(p);
    // Rename page-state keys to the API's RankFilters names.
    const rename: Record<string, string> = {
      q: 'search',
      funnel: 'funnelStage',
      tag: 'tagId',
      dir: 'sortDir',
    };
    for (const [from, to] of Object.entries(rename)) {
      const v = api.get(from);
      if (v != null) {
        api.delete(from);
        api.set(to, v);
      }
    }
    if (api.get('reserved') === '1') api.set('reservedOnly', '1');
    api.delete('reserved');
    if (api.get('awaiting') === '1') api.set('awaitingReply', '1');
    api.delete('awaiting');
    // Temperature = score band (hot ≥75, warm 50–74, cold <50), intersected
    // with any explicit score range — mirrors the server load's parser.
    const temp = api.get('temp');
    api.delete('temp');
    const num = (k: string) => (api.has(k) ? Number(api.get(k)) : undefined);
    let min = num('scoreMin');
    let max = num('scoreMax');
    if (temp === 'hot') min = Math.max(min ?? 75, 75);
    else if (temp === 'warm') {
      min = Math.max(min ?? 50, 50);
      max = Math.min(max ?? 74, 74);
    } else if (temp === 'cold') max = Math.min(max ?? 49, 49);
    api.delete('scoreMin');
    api.delete('scoreMax');
    if (min != null) api.set('minScore', String(min));
    if (max != null) api.set('maxScore', String(max));
    const pageNum = Math.max(1, Number(api.get('page') ?? 1));
    api.delete('page');
    api.set('limit', String(data.pageSize));
    api.set('offset', String((pageNum - 1) * data.pageSize));
    return api;
  }
  let queryError = $state<string | null>(null);
  async function runQuery(q: ServerQuery) {
    lastQuery = q;
    const seq = ++reqSeq;
    loading = true;
    queryError = null;
    try {
      const urlParams = buildParams(q);
      const res = await fetch(`/api/crm/contacts?${toApiParams(urlParams)}`);
      if (!res.ok) {
        if (seq === reqSeq) queryError = m.crm_bulk_failed();
        return;
      }
      const body: { contacts: Row[]; total: number } = await res.json();
      // Promise-identity guard: drop out-of-order resolutions.
      if (seq !== reqSeq) return;
      // Infinite scroll: page 1 replaces the list, later pages append.
      rows = q.page > 1 ? [...rows, ...body.contacts] : body.contacts;
      total = body.total;
      replaceState(`?${urlParams}`, {});
    } catch {
      if (seq === reqSeq) queryError = m.crm_bulk_failed();
    } finally {
      if (seq === reqSeq) loading = false;
    }
  }
  /** Page-owned toggles re-run the current table query from page 1. */
  const refetch = () => void runQuery({ ...lastQuery, page: 1 });
  // Seed the header sort arrow from the URL (server default = score desc).
  const URL_SORT_TO_COL: Record<string, string> = {
    score: 'score',
    recent: 'recent',
    name: 'name',
    revenue: 'revenue',
    frequency: 'msgs',
  };
  const initialSortFromUrl = {
    key: URL_SORT_TO_COL[qp.get('sort') ?? 'score'] ?? 'score',
    dir: (qp.get('dir') === 'asc' || (!qp.get('dir') && qp.get('sort') === 'name')
      ? 'asc'
      : 'desc') as 'asc' | 'desc',
  };

  // ── Columns (base + dynamic meta + conditional finance) ────────────────────
  // Server mode: sorting happens in SQL (`RankFilters.sort`), so only columns
  // with a server sort mapping (SORT_MAP below) stay sortable — a client
  // `sortFn` would silently reorder just the visible page.
  const columns = $derived.by<DataColumn<Row>[]>(() => {
    const cols: DataColumn<Row>[] = [
      {
        key: 'name',
        label: m.crm_col_contact(),
        custom: true,
        accessor: (c) => contactLabel(c.display_name),
        exportValue: (c) => contactLabel(c.display_name),
        width: 240,
      },
      {
        key: 'score',
        label: m.crm_col_score(),
        custom: true,
        accessor: (c) => c.score,
        width: 120,
      },
      {
        key: 'stage',
        label: m.crm_col_stage(),
        custom: true,
        sortable: false,
        accessor: (c) => c.stage,
        exportValue: (c) => stageLabel(c.stage),
        filter: { options: () => stageOptions, match: (c) => c.stage },
      },
      ...(isPersonal
        ? []
        : [
            {
              key: 'funnel',
              label: m.crm_funnel_col(),
              custom: true,
              sortable: false,
              accessor: (c: Row) => {
                const f = funnelOf(c);
                return f ? funnelStageLabel(f) : '';
              },
              exportValue: (c: Row) => {
                const f = funnelOf(c);
                return f ? funnelStageLabel(f) : '';
              },
              filter: { options: () => funnelOptions, match: (c: Row) => funnelOf(c) ?? '' },
            } satisfies DataColumn<Row>,
          ]),
      {
        key: 'verified',
        label: m.crm_col_verified(),
        custom: true,
        sortable: false,
        accessor: (c) => (c.dni_verified ? '✓' : ''),
        exportValue: (c) => (c.dni_verified ? 'yes' : 'no'),
        filter: { options: () => verifiedOptions, match: (c) => (c.dni_verified ? '1' : '0') },
        width: 96,
      },
      {
        key: 'sex',
        label: m.crm_col_sex(),
        defaultHidden: true,
        sortable: false,
        accessor: (c) => sexLabel(c),
        exportValue: (c) => sexLabel(c),
        filter: { options: () => sexOptions, match: (c) => c.sex ?? '' },
        width: 96,
      },
      ...(isPersonal
        ? []
        : [
            {
              key: 'origin',
              label: m.crm_col_origin(),
              custom: true,
              sortable: false,
              accessor: (c: Row) => originLabel(c),
              exportValue: (c: Row) => originOf(c),
              filter: { options: () => originOptions, match: (c: Row) => originOf(c) },
              width: 110,
            } satisfies DataColumn<Row>,
          ]),
    ];
    for (const k of metaKeys)
      cols.push({
        key: `meta:${k}`,
        label: metaLabel(k),
        custom: true,
        defaultHidden: true,
        sortable: false,
        accessor: (c) => metaDisplay(k, c.custom_fields?.[k]),
      });
    if (data.financeEnabled) {
      cols.push({
        key: 'revenue',
        money: true,
        label: m.crm_col_revenue(),
        align: 'right',
        custom: true,
        accessor: (c) => finOf(c)?.revenue ?? null,
        exportValue: (c) => finOf(c)?.revenue ?? '',
        width: 120,
      });
      cols.push({
        key: 'invoices',
        label: m.crm_col_invoices(),
        align: 'right',
        custom: true,
        sortable: false,
        accessor: (c) => finOf(c)?.invoices ?? null,
        exportValue: (c) => finOf(c)?.invoices ?? '',
        width: 96,
      });
      cols.push({
        key: 'lastPurchase',
        label: m.crm_col_last_purchase(),
        align: 'right',
        custom: true,
        sortable: false,
        accessor: (c) => finOf(c)?.lastPurchaseAt ?? null,
        exportValue: (c) => finOf(c)?.lastPurchaseAt ?? '',
        width: 120,
      });
    }
    cols.push({
      key: 'channels',
      label: m.crm_col_channels(),
      align: 'right',
      custom: true,
      sortable: false,
      accessor: (c) => (c.channels ?? []).join(', '),
      exportValue: (c) => (c.channels ?? []).join(', '),
      filter: {
        options: () => channelOptions,
        match: (c) => c.channels ?? [],
        icon: true,
        align: 'right',
      },
      width: 120,
    });
    cols.push({
      key: 'msgs',
      label: m.crm_col_msgs(),
      align: 'right',
      custom: true,
      accessor: (c) => c.total_msgs,
      exportable: false,
      width: 100,
    });
    cols.push({
      key: 'inbound',
      label: m.crm_export_inbound(),
      align: 'right',
      defaultHidden: true,
      sortable: false,
      accessor: (c) => c.inbound_msgs,
    });
    cols.push({
      key: 'outbound',
      label: m.crm_export_outbound(),
      align: 'right',
      defaultHidden: true,
      sortable: false,
      accessor: (c) => c.total_msgs - c.inbound_msgs,
    });
    cols.push({
      key: 'recent',
      label: m.crm_col_last_contact(),
      align: 'right',
      custom: true,
      accessor: (c) => c.last_contact_at,
      exportValue: (c) => c.last_contact_at ?? '',
      width: 120,
    });
    return cols;
  });

  // ── Actions ────────────────────────────────────────────────────────────────
  // DNI verified checkmark toggle → PATCH the party, then refresh the roster.
  let verifyBusy = $state<string | null>(null);
  async function toggleVerified(c: Row) {
    if (!c.party_id || verifyBusy) return;
    verifyBusy = c.party_id;
    try {
      const res = await fetch(`/api/crm/parties/${c.party_id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dniVerified: !c.dni_verified }),
      });
      if (res.ok) await invalidate('crm:contacts');
    } finally {
      verifyBusy = null;
    }
  }

  let syncing = $state(false);
  let creating = $state(false);
  let searchQuery = $state('');

  async function syncNow() {
    syncing = true;
    try {
      const res = await fetch('/api/crm/contacts/sync', { method: 'POST' });
      if (res.ok) await invalidate('crm:contacts');
    } finally {
      syncing = false;
    }
  }
  async function newContact() {
    creating = true;
    try {
      const res = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: m.crm_new_contact() }),
      });
      if (res.ok) {
        const { contact } = await res.json();
        await goto(`/crm/${contact.id}`);
      }
    } finally {
      creating = false;
    }
  }

  // ── Bulk actions (kebab) — Merge (CRM-only, 2+) + Delete, both confirmed ──
  let selected = $state<Set<string>>(new Set());
  let bulkBusy = $state(false);
  let bulkErr = $state<string | null>(null);
  // Merge → shared column-per-candidate conflict resolver.
  let mergeOpen = $state(false);
  let mergeRows = $state<Row[]>([]);
  const mergeContacts = $derived(
    mergeRows.map((r) => {
      const fin = finOf(r);
      const subtitle = [
        m.crm_merge_msgs({ n: r.total_msgs }),
        fin && fin.revenue > 0 ? formatMoney(fin.revenue, 'PEN', { decimals: 0 }) : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        id: r.contact_id,
        name: contactLabel(r.display_name),
        subtitle,
        messages: r.total_msgs,
        // Per-identity channel + native id (phone / user id), formatted for display.
        identities: (r.identities ?? []).map((i) => ({
          channel: i.channel,
          value: identityValue(i.externalId, i.handle),
        })),
      };
    }),
  );
  // Resolvable fields: the name + every custom_fields key present across the
  // selected contacts (dni / phone / email / …). The modal only surfaces the ones
  // that actually conflict (2+ distinct values).
  const mergeFields = $derived.by<MergeField[]>(() => {
    const fields: MergeField[] = [];
    const nameVals = mergeRows
      .map((r) => ({ contactId: r.contact_id, value: (r.display_name ?? '').trim() }))
      .filter((v) => v.value);
    if (nameVals.length)
      fields.push({ key: 'display_name', label: m.crm_col_contact(), values: nameVals });
    const keys = new Set<string>();
    for (const r of mergeRows) for (const k of Object.keys(r.custom_fields ?? {})) keys.add(k);
    for (const k of keys) {
      // Structured values (funnel object, journey event array, …) can't be
      // resolved through a text field — String() renders "[object Object]" and
      // a pick would write that string back over the structure. Scalars only;
      // structured fields keep the survivor's data untouched.
      if (mergeRows.some((r) => typeof (r.custom_fields?.[k] ?? '') === 'object')) continue;
      const vals = mergeRows
        .map((r) => ({ contactId: r.contact_id, value: String(r.custom_fields?.[k] ?? '').trim() }))
        .filter((v) => v.value);
      if (vals.length) fields.push({ key: k, label: metaLabel(k), values: vals });
    }
    return fields;
  });
  // Delete → simple confirm modal.
  let deleteOpen = $state(false);
  let deleteIds = $state<string[]>([]);

  const bulkActions = $derived.by(() => {
    if (!canAct('crm', 'edit')) return [];
    const acts: {
      label: string;
      danger?: boolean;
      onSelect: (ids: Set<string>, rows: Row[]) => void;
    }[] = [];
    if (selected.size >= 2)
      acts.push({
        label: m.crm_bulk_merge_action(),
        onSelect: (_ids, rows) => {
          mergeRows = rows;
          bulkErr = null;
          mergeOpen = true;
        },
      });
    acts.push({
      label: m.crm_bulk_delete_action({ n: selected.size }),
      danger: true,
      onSelect: (ids) => {
        deleteIds = [...ids];
        bulkErr = null;
        deleteOpen = true;
      },
    });
    return acts;
  });

  async function runMerge(res: MergeResolution) {
    if (!res.survivorId || res.loserIds.length === 0) return;
    bulkBusy = true;
    bulkErr = null;
    try {
      await applyContactMerge(res.survivorId, res.loserIds, res.resolved);
      selected = new Set();
      mergeOpen = false;
      await invalidate('crm:contacts');
    } catch {
      bulkErr = m.crm_bulk_failed();
    } finally {
      bulkBusy = false;
    }
  }
  async function runDelete() {
    bulkBusy = true;
    bulkErr = null;
    try {
      const res = await Promise.all(
        deleteIds.map((id) => fetch(`/api/crm/contacts/${id}`, { method: 'DELETE' })),
      );
      if (res.some((r) => !r.ok)) throw new Error('delete');
      selected = new Set();
      deleteOpen = false;
      await invalidate('crm:contacts');
    } catch {
      bulkErr = m.crm_bulk_failed();
    } finally {
      bulkBusy = false;
    }
  }
</script>

<svelte:head><title>{m.crm_nav_customers()} — {m.crm_title()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="crm-customers-title"
  class="crm-customers-surface"
>
  <PageHeader
    titleId="crm-customers-title"
    title={m.crm_nav_customers()}
    subtitle={m.crm_subtitle()}
  >
    {#snippet leading()}<Contact size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <DataTable
    class="flex-1 min-h-0"
    {columns}
    data={rows}
    server={{ total, loading, pageSize: data.pageSize, infinite: true, onQuery: runQuery }}
    getRowId={(c) => c.contact_id}
    searchPlaceholder={m.crm_search_placeholder()}
    bind:search={searchQuery}
    {initialFilters}
    initialSort={initialSortFromUrl}
    selectable
    bind:selectedIds={selected}
    {bulkActions}
    exportable={canAct('crm', 'export')}
    exportName="customers"
    storageKey={`crm-customers:${data.orgId ?? 'default'}`}
    onRowClick={(c) => goto(`/crm/${c.contact_id}`)}
    addLabel={m.crm_new_contact()}
    onAdd={newContact}
    addDisabled={creating || !canAct('crm', 'edit')}
    emptyMessage={m.crm_empty_title()}
  >
    {#snippet toolbar()}
      <Select
        bind:value={tagId}
        onchange={refetch}
        class="h-7 px-2 text-xs rounded-[var(--radius-sm)] bg-bg3 border border-[var(--hairline)]"
      >
        <option value="">{m.crm_all_tags()}</option>
        {#each tags as tg (tg.id)}<option value={tg.id}>{tg.name}</option>{/each}
      </Select>
      {#if data.financeEnabled}
        <Button
          variant="ghost"
          size="sm"
          class={`res-toggle ${reservedFilter ? 'active' : ''}`}
          aria-pressed={reservedFilter}
          onclick={() => {
            reservedFilter = !reservedFilter;
            refetch();
          }}
          title={m.crm_reserved_only()}
        >
          {m.crm_reserved_badge()}
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        class={`await-toggle ${awaitingFilter ? 'active' : ''}`}
        aria-pressed={awaitingFilter}
        onclick={() => {
          awaitingFilter = !awaitingFilter;
          refetch();
        }}
        title={m.crm_awaiting_hint()}
      >
        {m.crm_awaiting_filter()}
      </Button>
      {#if scoreActive}
        <Button
          variant="ghost"
          size="sm"
          class="chip"
          onclick={() => {
            scoreMin = null;
            scoreMax = null;
            refetch();
          }}
          title={m.crm_filter_clear()}
        >
          {m.crm_filter_score({ min: scoreMin ?? 0, max: scoreMax ?? 100 })}
          <X size={11} />
        </Button>
      {/if}
      {#if tempFilter}
        <Button
          variant="ghost"
          size="sm"
          class="chip"
          onclick={() => {
            tempFilter = '';
            refetch();
          }}
          title={m.crm_filter_clear()}
        >
          {m.crm_filter_temp({ temp: tempFilter })}
          <X size={11} />
        </Button>
      {/if}
    {/snippet}

    {#snippet actions()}
      <Button
        variant="outline"
        size="sm"
        onclick={syncNow}
        disabled={syncing || !canAct('crm', 'edit')}
        title={canAct('crm', 'edit') ? undefined : m.no_permission()}
      >
        <RefreshCw size={14} class={syncing ? 'animate-spin' : ''} />
        {syncing ? m.crm_syncing() : m.crm_sync_now()}
      </Button>
    {/snippet}

    {#snippet cell(c: Row, col: DataColumn<Row>)}
      {#if col.key === 'name'}
        <div class="font-medium truncate max-w-[24rem]" title={contactLabel(c.display_name)}>
          <Highlight text={contactLabel(c.display_name)} query={searchQuery} />
        </div>
        {#if c.source === 'manual'}<span class="t-caption">{m.crm_source_manual()}</span>{/if}
      {:else if col.key === 'score'}
        <ScoreCell score={c.score} r={c.r_score} f={c.f_score} m={c.m_score} />
      {:else if col.key === 'stage'}
        <StagePill stage={c.stage} overridden={false} />
      {:else if col.key === 'funnel'}
        <div class="flex items-center gap-1">
          <FunnelStagePill stage={funnelOf(c)} />
          {#if reservedOnly(c)}<span class="res-pill" title={m.crm_reserved_only()}
              >{m.crm_reserved_badge()}</span
            >{/if}
        </div>
      {:else if col.key === 'verified'}
        <Button
          variant="ghost"
          size="sm"
          class="verify-toggle"
          disabled={!c.party_id || !canAct('crm', 'edit') || verifyBusy === c.party_id}
          title={c.dni_verified ? m.crm_verified_hint() : m.crm_unverified_hint()}
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            toggleVerified(c);
          }}
        >
          {#if c.dni_verified}
            <CircleCheck size={iconSizes.md} class="verify-icon-on" />
          {:else}
            <Circle size={iconSizes.md} class="verify-icon-off" />
          {/if}
        </Button>
      {:else if col.key === 'origin'}
        {#if c.lead_origin === 'ad'}
          <span class="origin-pill origin-ad" title={c.lead_campaign ?? m.crm_origin_ad()}
            ><Megaphone size={iconSizes.xs} /> {m.crm_origin_ad()}</span
          >
        {:else if c.lead_origin === 'organic'}
          <span class="origin-pill origin-organic"
            ><Sprout size={iconSizes.xs} /> {m.crm_origin_organic()}</span
          >
        {:else}
          <span class="t-caption">—</span>
        {/if}
      {:else if col.key.startsWith('meta:')}
        {@const v = metaDisplay(col.key.slice(5), c.custom_fields?.[col.key.slice(5)])}
        <span class="meta-cell" title={v}>{v || '—'}</span>
      {:else if col.key === 'revenue'}
        <span class="t-caption tabular-nums"
          >{finOf(c) ? formatMoney(finOf(c)!.revenue, 'PEN', { decimals: 0 }) : '—'}</span
        >
      {:else if col.key === 'invoices'}
        <span class="t-caption tabular-nums">{finOf(c) ? finOf(c)!.invoices : '—'}</span>
      {:else if col.key === 'lastPurchase'}
        <span class="t-caption"
          >{finOf(c)?.lastPurchaseAt ? relativeTime(finOf(c)!.lastPurchaseAt!) : '—'}</span
        >
      {:else if col.key === 'channels'}
        {#if c.channels && c.channels.length > 0}
          <div class="flex items-center justify-end gap-1.5 text-muted-foreground">
            {#each c.channels as ch (ch)}<ChannelBrandIcon channel={ch} size={15} />{/each}
          </div>
        {:else}
          <div class="text-right text-muted-foreground">—</div>
        {/if}
      {:else if col.key === 'msgs'}
        <div class="msgs">
          {#if c.awaiting_reply}<span class="await-dot" title={m.crm_awaiting_hint()}></span>{/if}
          <span class="m-in" title={m.crm_inbound_value({ count: c.inbound_msgs })}
            ><ArrowDown size={11} />{c.inbound_msgs}</span
          >
          <span class="m-out" title={m.crm_outbound_value({ count: c.total_msgs - c.inbound_msgs })}
            ><ArrowUp size={11} />{c.total_msgs - c.inbound_msgs}</span
          >
        </div>
      {:else if col.key === 'recent'}
        <span class="t-caption">{relativeTime(c.last_contact_at)}</span>
      {/if}
    {/snippet}

    {#snippet filterOptionIcon(v)}<ChannelBrandIcon channel={v} size={14} />{/snippet}
  </DataTable>
  {#if queryError}<p class="err-msg" role="alert">{queryError}</p>{/if}
</PageShell>

<CrmMergeResolver
  bind:open={mergeOpen}
  contacts={mergeContacts}
  fields={mergeFields}
  busy={bulkBusy}
  error={bulkErr}
  onConfirm={runMerge}
/>

<Modal bind:open={deleteOpen} title={m.crm_bulk_delete_title()}>
  <p class="t-body">{m.crm_bulk_delete_confirm({ n: deleteIds.length })}</p>
  {#if bulkErr}<p class="err-msg">{bulkErr}</p>{/if}
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (deleteOpen = false)}
      >{m.common_cancel()}</Button
    >
    <Button variant="danger" size="sm" onclick={runDelete} disabled={bulkBusy}
      >{m.crm_bulk_delete_btn()}</Button
    >
  {/snippet}
</Modal>

<style>
  .err-msg {
    font-size: var(--font-size-body, 14px);
    color: var(--color-destructive);
    margin-top: var(--space-2, 8px);
  }
  :global(.crm-customers-surface .verify-toggle) {
    height: var(--control-height-xs);
    padding-inline: var(--space-1);
  }
  :global(.crm-customers-surface .verify-icon-on) {
    color: var(--color-success-fg);
  }
  :global(.crm-customers-surface .verify-icon-off) {
    color: var(--color-text-tertiary);
  }
  :global(.crm-customers-surface .res-toggle) {
    display: inline-flex;
    align-items: center;
    height: 1.5rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-warning);
    color: var(--color-warning);
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color var(--duration-fast) var(--ease-standard);
  }
  :global(.crm-customers-surface .res-toggle:hover) {
    background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  }
  :global(.crm-customers-surface .res-toggle.active) {
    background: color-mix(in srgb, var(--color-warning) 20%, transparent);
  }
  .res-pill {
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    border-radius: var(--radius-full);
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 15%, transparent);
    white-space: nowrap;
  }
  /* Lead-origin pills (Meta attribution): paid ad vs organic first contact. */
  .origin-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }
  .origin-ad {
    color: var(--color-info-fg);
    background: var(--color-info-surface);
    border: 1px solid var(--color-info-border);
  }
  .origin-organic {
    color: var(--color-success-fg);
    background: var(--color-success-surface);
    border: 1px solid var(--color-success-border);
  }
  :global(.crm-customers-surface .await-toggle) {
    display: inline-flex;
    align-items: center;
    height: 1.5rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color var(--duration-fast) var(--ease-standard);
  }
  :global(.crm-customers-surface .await-toggle:hover) {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  :global(.crm-customers-surface .await-toggle.active) {
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  }
  .await-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    background: var(--color-accent);
    box-shadow: var(--shadow-overlay);
  }
  :global(.crm-customers-surface .chip) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    height: 1.5rem;
    padding: 0 var(--space-2) 0 var(--space-2);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    white-space: nowrap;
    text-transform: capitalize;
  }
  :global(.crm-customers-surface .chip:hover) {
    background: color-mix(in srgb, var(--color-accent) 24%, transparent);
  }
  .msgs {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2, 8px);
    font-variant-numeric: tabular-nums;
  }
  .m-in {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5, 2px);
    color: var(--color-emerald, var(--color-success));
  }
  .m-out {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5, 2px);
    color: var(--color-muted-foreground);
  }
  .meta-cell {
    display: inline-block;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-muted-foreground);
  }
</style>
