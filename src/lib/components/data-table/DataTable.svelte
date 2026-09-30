<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { FilterGroup, FilterKind, FilterValue } from './filters';
  import type { GroupSpec } from './group-by';

  export type { FilterGroup, FilterKind, FilterValue };

  /** Row height preset — drives the virtualizer estimate and `--dt-row-h`. */
  export type Density = 'compact' | 'normal' | 'comfortable';
  /** How the table is sized: fill its flex parent, hug its rows, or a CSS length. */
  export type TableHeight = 'fill' | 'fit' | (string & {});
  /** Individually switchable toolbar/header affordances — see the `chrome` prop. */
  export type ChromeFeature =
    'search' | 'columns' | 'export' | 'add' | 'bulk' | 'reorder' | 'filter';

  /**
   * A single column definition for the shared {@link DataTable}. One typed array
   * of these drives every toolset: render, sort, enum-filter, global search,
   * show/hide, reorder, resize, wrap, aggregate, inline-edit, and CSV/XLSX
   * export. Everything is optional except `key`/`label`.
   */
  export type DataColumn<T> = {
    /** Stable id — used for visibility/order/width state and as the default accessor key. */
    key: string;
    /** Header text (already localized). */
    label: string;
    /** Value used for sort, enum-filter, global search, aggregate, and default cell/export.
     *  Defaults to `(row) => (row as any)[key]`. */
    accessor?: (row: T) => unknown;
    /** Render this column via the table's `cell` snippet instead of default text.
     *  (Snippets can't live on the column object — a duplicate-`svelte` brand clash —
     *  so custom cells are switched on `key` inside one `cell` snippet prop, or
     *  passed per column through the `cells` RECORD, which needs no flag here.) */
    custom?: boolean;
    /** Render this column's header via the table's `headerCell` snippet (label stays for menus). */
    customHeader?: boolean;
    /** Absorb the pane's leftover width (instead of the trailing spacer); `width` becomes its minimum. */
    fill?: boolean;
    align?: 'left' | 'right' | 'center';
    /** Initial width in px (user can resize unless `resizable: false`). */
    width?: number;
    headerClass?: string;
    cellClass?: string;

    /** Clickable sort header. Default true. */
    sortable?: boolean;
    /** Custom comparator (ascending). Default compares `accessor` values. */
    sortFn?: (a: T, b: T) => number;

    /** Per-column filter in the header (uses the shared ColumnFilter popover). */
    filter?: {
      /** `enum` (default) = multi-select over `options`. `text` = case-insensitive
       *  contains. `number`/`date` = an INCLUSIVE min/max range. */
      kind?: FilterKind;
      /** Required for the `enum` kind; ignored by the others. */
      options?: () => { value: string; label: string }[];
      match?: (row: T) => unknown;
      /** Render option icons via the table's `filterOptionIcon` snippet. */
      icon?: boolean;
      align?: 'left' | 'right';
    };

    /** Can be hidden via the column menu. Default true. */
    hideable?: boolean;
    /** Start hidden (still toggleable). Default false. */
    defaultHidden?: boolean;
    /** Allow drag-resizing the column. Default true. */
    resizable?: boolean;
    /** Force numeric treatment for the header-aggregate menu (else auto-detected). */
    numeric?: boolean;
    /** This column holds money — sum/avg aggregates render with the currency
     *  symbol via `formatMoney`. Pass an ISO code to override the org default. */
    money?: boolean | string;

    /** Primitive value type. Drives the default renderer (boolean check,
     *  localized date, select label), the in-place editor widget, and fill
     *  coercion. Defaults to `'text'` (or `'number'` when `numeric`/`money` is set). */
    type?: CellType;
    /** Options for a `select` column (value = what the draft carries). */
    options?: () => { value: string; label: string }[];
    /** Inline-editable cell (Notion-style: click selects, click again / Enter /
     *  typing opens the editor; Excel fill handle repeats the selection down or
     *  up). Every commit calls `onSaveRow` with the FULL editable snapshot plus
     *  the change, so a caller's partial PATCH never wipes sibling fields. */
    editable?: boolean;
    /** A custom-rendered cell owns its editor and persistence, but still obeys
     *  the table permission and organization field-editability switches. */
    customEditable?: boolean;

    /** Include in export. Default true. */
    exportable?: boolean;
    /** Export value. Defaults to `accessor`. */
    exportValue?: (row: T) => string | number;
    /** Checked by default in the export dialog. Defaults to `!defaultHidden`. */
    exportDefault?: boolean;
  };

  /** Primitive cell types — see {@link DataColumn.type}. */
  export type CellType = 'text' | 'number' | 'boolean' | 'date' | 'select';

  /** Draft map handed to `onSaveRow` — column `key` → current value as a string
   *  (`boolean` ⇒ `'true'|'false'`, `date` ⇒ `'YYYY-MM-DD'`, `select` ⇒ option value). */
  export type EditDraft = Record<string, string>;

  /** Runtime policy passed to custom cells. Domain components keep their own
   * persistence outside DataTable while sharing its editability contract.
   * `open`/`onOpenChange` wire the cell into DataTable's own selection: the
   * cell is selected on the first click, and a second click / Enter on the
   * SELECTED cell flips `open` true so the cell can mount its own editor
   * (e.g. a tag popover) instead of owning a separate always-visible trigger.
   * `onOpenChange(false)` tells DataTable to clear it (Escape/outside-click/
   * a value picked). */
  export type DataCellContext = {
    canEdit: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };

  /** Header-aggregate modes (non-exclusive per column). */
  export type AggMode = 'sum' | 'avg' | 'count';

  /** A bulk action shown in the toolbar kebab when rows are selected. */
  export type BulkAction<T> = {
    label: string;
    danger?: boolean;
    onSelect: (ids: Set<string>, rows: T[]) => void;
  };

  /** One server-mode query — fired on every search/sort/filter/page change. */
  export type ServerQuery = {
    search: string;
    /** The PRIMARY sort (multi-sort's first entry), for one-key server APIs. */
    sort: { key: string; dir: 'asc' | 'desc' } | null;
    /** Every active sort, in precedence order (`maxSort > 1`). Always supplied by
     *  the table; optional so a caller can still build a query literal by hand. */
    sorts?: { key: string; dir: 'asc' | 'desc' }[];
    /** One encoded value per active column key: an `enum` joins its values with
     *  commas, `text` passes through, a range encodes as `min~max`. */
    filters: Record<string, string>;
    /** The structured form of the same selections, for a richer server API. */
    filterValues?: Record<string, FilterValue>;
    page: number;
    pageSize: number;
  };

  /**
   * Opt-in server mode (spec 2026-08-13 §S4): absent ⇒ current client-only
   * behavior, byte-identical, for every existing consumer. Present ⇒ `data` is
   * rendered as-is (the caller already applied search/filter/sort/page), the
   * "showing" label and pager read `total` instead of `data.length`, and every
   * interaction calls `onQuery` instead of mutating the table locally.
   */
  export type ServerMode = {
    total: number;
    loading?: boolean;
    /** Rows per page. Defaults to the first page's `data.length`. */
    pageSize?: number;
    /** Scroll pagination: instead of prev/next buttons, nearing the bottom of
     *  the scroll container requests the next page via `onQuery` — the CALLER
     *  appends the new rows to `data` (page 1 replaces, page >1 appends). */
    infinite?: boolean;
    onQuery: (q: ServerQuery) => void;
    /** Delegate export to a server endpoint so it covers the full filtered set. */
    onExport?: (format: 'csv' | 'xlsx', keys: string[]) => void;
    exportFormats?: ('csv' | 'xlsx')[];
    /** Resolve ids for the complete current filter, beyond loaded rows. */
    onSelectAllMatching?: () => Promise<string[]>;
  };
</script>

<script lang="ts" generics="T">
  import { tick, untrack, onDestroy } from 'svelte';
  import { tryUseActions } from '$lib/services/actions/context';
  import type { CommandContext, CommandOutcome } from '$lib/services/actions/definition';
  import {
    createRowSaveController,
    completeRowSaves,
    runDraftCommand,
    type RowSaveResult,
    type RowOutcome,
    type RowSaveController,
  } from './row-save';
  import { browser } from '$app/environment';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import {
    ArrowUp,
    ArrowDown,
    ChevronsUpDown,
    ChevronLeft,
    ChevronRight,
    Columns3,
    Check,
    Minus,
    Download,
    Plus,
    X,
    Search,
    GripVertical,
    WrapText,
    Sigma,
    Divide,
    Hash,
    ArrowUpRight,
    Settings2,
    ChevronDown,
    ListFilter,
    MoreHorizontal,
  } from 'lucide-svelte';
  import {
    Button,
    Skeleton,
    Tooltip,
    Dropdown,
    Select,
    Popover,
    Toggle,
    Input,
    SegmentedControl,
    iconSizes,
  } from '$lib/components/ui';
  import type { DropdownItem } from '$lib/components/ui/Dropdown.svelte';
  import { formatMoney } from '$lib/utils/format';
  import { can } from '$lib/state/features/permissions.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { invalidate } from '$lib/navigation';
  import { syncPreferenceToServer } from '$lib/state/ui/preference-sync.svelte';
  import {
    openModeFor,
    peekClick,
    openRecord,
    isOpenMode,
    OPEN_MODES,
    userOpenModes,
    type OpenMode,
  } from '$lib/records/peek.svelte';
  import {
    bulkEditableColumns,
    bulkEditJobs,
    planCustomBulkEdit,
    resolveRowOpen,
  } from './bulk-edit';
  import TagOptionList from '$lib/components/tags/TagOptionList.svelte';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import { tagBulkState, tagBulkIntent, bulkLinkTags } from '$lib/components/tags/tag-bulk';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import type { TagScope } from '$lib/tags/scope';
  import ColumnFilter from './ColumnFilter.svelte';
  import FilterAddMenu from './FilterAddMenu.svelte';
  import FilterChip from './FilterChip.svelte';
  import AdvancedFilterBuilder from './AdvancedFilterBuilder.svelte';
  import ExportDialog from './ExportDialog.svelte';
  import GroupByPicker from './GroupByPicker.svelte';
  import {
    emptyFilter,
    emptyRule,
    filterToParam,
    isFilterActive,
    matchesFilter,
    matchesGroup,
    newId,
    opsFor,
    type FilterColumnMeta,
  } from './filters';
  import { opLabel } from './filter-ops';
  import { groupRows, type RowGroup } from './group-by';
  import { downloadCsv, downloadXlsx, type Rows } from '$lib/export/table-export';
  import { createHotkeysAttachment } from '$lib/hotkeys';
  import { createVirtualizer } from '$lib/virtual/virtualizer.svelte';
  import { tableConfig } from '$lib/tables/config.svelte';
  import { TABLE_BY_ID } from '$lib/tables/defs';
  import { formatId, resolveTable } from '$lib/tables/registry';
  import {
    CUSTOM_PROPERTY_QUERY_RECORDS_MAX,
    customPropertyColumnKey,
    validateCustomPropertyValue,
  } from '$lib/tables/custom-properties';
  import type {
    CustomPropertyBundle,
    CustomPropertyDefinition,
    CustomPropertyTableId,
    CustomPropertyValue,
    CustomPropertyValueCell,
  } from '$lib/tables/custom-properties';
  import CustomPropertyCell from './custom-properties/CustomPropertyCell.svelte';
  import { primaryFormulaVariable } from '$lib/tables/formula';
  import CustomPropertyManager from './custom-properties/CustomPropertyManager.svelte';
  import {
    createCustomPropertyManagerActions,
    createCustomPropertyValueActions,
    loadCustomPropertyBundle,
    loadCustomPropertyDefinitions,
  } from './custom-properties/api';
  import type { CustomPropertyTableConfig } from './custom-properties/types';
  import {
    customPropertyDisplay,
    customPropertySortValue,
    isCustomPropertyRecordAvailable,
  } from './custom-properties/value';

  let {
    variant = 'full',
    data,
    columns: columnsProp,
    tableId,
    idColumn,
    titleColumn,
    openIn,
    rowOpen,
    getRowId,
    searchable,
    searchPlaceholder,
    searchFields,
    search = $bindable(''),
    exportable,
    exportName = 'export',
    selectable = false,
    selectedIds = $bindable(new Set<string>()),
    onSelectionChange,
    bulkActions,
    columnMenu,
    reorderable,
    resizable = true,
    chrome,
    storageKey,
    onRowClick,
    addLabel,
    onAdd,
    addMenu,
    onAddSelect,
    addDisabled = false,
    canEdit = true,
    onSaveRow,
    onSaveComplete,
    rowSaveController,
    editDisabled = false,
    initialSort,
    initialFilters,
    // server mode
    server,
    // expansion
    getSubRows,
    expandedContent,
    isExpandable,
    initialExpanded,
    expanded = $bindable(new Set<string>(initialExpanded ?? [])),
    // geometry
    density = 'normal',
    height,
    virtualize,
    stickyColumns = 0,
    // states
    loading = false,
    loadingRows = 6,
    error,
    onRetry,
    // sort / filter
    sort = $bindable(
      initialSort ? [{ key: initialSort.key, dir: initialSort.dir ?? ('asc' as const) }] : [],
    ),
    maxSort = 1,
    filters = $bindable(
      Object.fromEntries(
        Object.entries(initialFilters ?? {}).map(([key, values]) => [
          key,
          { kind: 'enum' as const, values },
        ]),
      ),
    ),
    filterChips = true,
    advanced = $bindable(null),
    filterBar,
    // grouping / footer
    groupBy,
    groupOptions,
    groupValue = $bindable(''),
    onGroupChange,
    groupNoneLabel,
    footer = false,
    rowActionsMode = 'hover',
    rowClass,
    rowStyle,
    // slots
    cell,
    cells,
    headerCell,
    headers,
    rowActions,
    groupRow,
    footerCell,
    errorContent,
    empty,
    chips,
    filterOptionIcon,
    toolbar,
    actions,
    options,
    customProperties,
    tagScope,
    tagsOf,
    emptyMessage,
    class: className = '',
    style: styleProp,
    ...rest
  }: {
    /** `plain` = embedded read-mostly table (detail cards, panels): no search /
     *  column menu / reorder by default (resize IS on — owner directive
     *  2026-09-26: every primitive table view lets you adjust column widths),
     *  intrinsic height (the PAGE scrolls), every row rendered — no
     *  virtualizer. Height is intrinsic but
     *  WIDTH is still contained: the table keeps its `min-width` (fixed column
     *  layout), so the wrapper owns an `overflow-x` scroller. Without it a
     *  wider-than-its-card table pushed the whole page wider and the nearest
     *  scrolling ancestor scrolled every sibling card sideways with it
     *  (root-caused 2026-09-25 on /stock/entries/[id]). `full` (default) is the
     *  module-page table: chrome on, fills its flex parent, virtualized.
     *
     *  `variant` is only a PRESET — it fills defaults for orthogonal knobs and
     *  never overrides one a caller passed:
     *
     *  | knob            | `full`  | `plain`                      |
     *  |-----------------|---------|------------------------------|
     *  | `searchable`    | `true`  | `false`                      |
     *  | `columnMenu`    | `true`  | `false`                      |
     *  | `reorderable`   | `true`  | `false`                      |
     *  | `exportable`    | `false` | `false`                      |
     *  | `resizable`     | `true`  | `true` (owner directive)     |
     *  | `height`        | `fill`  | `fit`                        |
     *  | `virtualize`    | `true`  | `false` (`true` with `height`)|
     *
     *  `chrome` overrides the first four in one go; an explicit per-item prop
     *  still wins over both. */
    variant?: 'full' | 'plain';
    data: T[];
    columns: DataColumn<T>[];
    /** Registry id (`$lib/tables/defs`, e.g. `stock.items`): applies the org's
     *  table config — ID prefix, field label overrides, default visibility,
     *  editing switched off — as set on /settings/tables. */
    tableId?: string;
    /** Leading ID column: `PREFIX` + the entity's HUMAN code (never the UUID).
     *  Read-only by contract; the prefix comes from the org config (or the
     *  registry default) when `tableId` is set. */
    idColumn?: { value: (row: T) => string | number | null | undefined; label?: string };
    /** The Title column — the clickable field that opens the record. Its cell
     *  stays editable when the column is; the link is the text when it is not,
     *  and always a hover "open" affordance (Notion). */
    titleColumn?: { key: string; href: (row: T) => string };
    /** Explicit open mode for records opened from this table (title link, `.dt-open`,
     *  a plain row click via `rowOpen`). Wins over the org's `tableId` config. */
    openIn?: OpenMode;
    /** A plain row click opens the title href in the resolved mode. Defaults to
     *  true when `titleColumn` is set and no `onRowClick` was passed. */
    rowOpen?: boolean;
    getRowId: (row: T) => string;
    searchable?: boolean;
    searchPlaceholder?: string;
    searchFields?: (row: T) => string;
    search?: string;
    exportable?: boolean;
    exportName?: string;
    selectable?: boolean;
    selectedIds?: Set<string>;
    onSelectionChange?: (ids: Set<string>, rows: T[]) => void;
    /** Bulk actions in the toolbar kebab (shown when rows are selected). */
    bulkActions?: BulkAction<T>[];
    columnMenu?: boolean;
    reorderable?: boolean;
    resizable?: boolean;
    /** Decompose the chrome bundle: `false` = none, or list exactly the
     *  affordances to keep. An explicit `searchable`/`columnMenu`/`reorderable`/
     *  `exportable` still wins over this (they are the per-item form). */
    chrome?: boolean | ChromeFeature[];
    storageKey?: string;
    onRowClick?: (row: T) => void;
    addLabel?: string;
    onAdd?: () => void;
    /** When provided, the + button opens this menu instead of calling onAdd. */
    addMenu?: DropdownItem[];
    onAddSelect?: (value: string) => void;
    addDisabled?: boolean;
    /** Permission gate for cell editing (the server enforces its own). */
    canEdit?: boolean;
    /** Share row ordering with sibling controls on the same entity. */
    rowSaveController?: RowSaveController;
    /** Persist one row's editable snapshot. Resolve `false`/throw ⇒ the changed
     *  cells retain their draft on failure. Rich outcomes distinguish an acknowledged
     *  write from a failed refresh. Unknown writes require authoritative reload. */
    onSaveRow?: (row: T, draft: EditDraft, context?: CommandContext) => Promise<RowSaveResult>;
    /** Projection refresh, coalesced once after each committed edit/fill batch. */
    onSaveComplete?: () => Promise<void>;
    editDisabled?: boolean;
    initialSort?: { key: string; dir?: 'asc' | 'desc' };
    initialFilters?: Record<string, string[]>;
    /** Opt-in server mode — see {@link ServerMode}. Absent ⇒ current client-only behavior. */
    server?: ServerMode;
    /** Same-shape children rendered as indented sub-rows when a row is expanded. */
    getSubRows?: (row: T) => T[] | null | undefined;
    /** Custom block rendered under a row when expanded (different-shape children). */
    expandedContent?: Snippet<[T]>;
    /** Gate the expand affordance (default: has sub-rows, or `expandedContent` is set). */
    isExpandable?: (row: T) => boolean;
    /**
     * Row ids to start expanded. Re-seeded whenever the SET of ids changes, so
     * switching a grouping axis re-opens the new groups instead of leaving the
     * user facing a wall of collapsed headers; a manual collapse survives until
     * then. Without this, `getSubRows` grouping renders headers only, and at a
     * POS that means an extra click before every sale.
     */
    initialExpanded?: string[];
    /** Bindable set of expanded row ids — `bind:expanded` to open/close rows from outside. */
    expanded?: Set<string>;
    /** Row height preset: 36 / 44 / 52 px, published as `--dt-row-h`. */
    density?: Density;
    /** `fill` (default for `full`) stretches to the flex parent, `fit` (default
     *  for `plain`) hugs its rows and lets the PAGE scroll, and any CSS length
     *  makes a fixed scroll pane — which is what a caller wrapping the table in
     *  a `height: 22rem` div was reaching for. */
    height?: TableHeight;
    /** Row virtualization. Defaults to `variant === 'full'`, plus any table with
     *  a fixed `height` (it owns a scroll pane, so it can window its rows). */
    virtualize?: boolean;
    /** Freeze the first N DATA columns (after the checkbox/expand gutters). */
    stickyColumns?: number;
    /** Render `loadingRows` skeleton rows instead of the empty state. */
    loading?: boolean;
    loadingRows?: number;
    /** Non-nullish ⇒ the table renders `errorContent` (or a message + retry)
     *  instead of rows. */
    error?: unknown;
    onRetry?: () => void;
    /** Active sorts in precedence order. One entry = today's single sort. */
    sort?: { key: string; dir: 'asc' | 'desc' }[];
    /** How many columns may sort at once. `1` (default) = today's behavior;
     *  above 1, Shift+clicking a header APPENDS instead of replacing. */
    maxSort?: number;
    /** Active column filters, keyed by column key. */
    filters?: Record<string, FilterValue>;
    /** Render a removable chip per active column filter + "Clear all". */
    filterChips?: boolean;
    /** Notion-style advanced rule tree (And/Or groups over any filterable
     *  column), layered on top of `filters` after the per-column matches.
     *  Ignored in server mode (ledger: no server parser for the rule tree
     *  yet) — the "+ Filter" menu hides "Add advanced filter" there too. */
    advanced?: FilterGroup | null;
    /** Shows the toolbar "+ Filter" entry point. Defaults to `true` when any
     *  column declares `filter` on a `full`-variant table, `false` otherwise
     *  (e.g. `variant="plain"`). */
    filterBar?: boolean;
    /** Bucket rows under synthetic header rows along one axis. */
    groupBy?: GroupSpec<T>;
    /** Toolbar "Group by" picker options (spec 2026-09-29 table-toolbar): when
     *  given, renders `GroupByPicker` in the grouped view-tools segment. Purely
     *  a UI affordance for CHOOSING an axis — the caller still builds the
     *  actual `groupBy` GroupSpec from the picked `groupValue` (see
     *  /pos/catalog for the reference wiring). */
    groupOptions?: { value: string; label: string }[];
    /** Current picked axis. `''` = no grouping. */
    groupValue?: string;
    /** Fires with the new value (in addition to `bind:groupValue`). */
    onGroupChange?: (value: string) => void;
    /** Label for the "no grouping" choice, prepended to `groupOptions`. */
    groupNoneLabel?: string;
    /** Render a footer row from the columns' active header aggregates. */
    footer?: boolean;
    /** `hover` (default) reveals row actions on row hover / keyboard focus;
     *  `always` keeps them visible. */
    rowActionsMode?: 'hover' | 'always';
    /** Extra classes / inline style for a row's `<tr>` (severity tints, etc.). */
    rowClass?: (row: T) => string | undefined;
    rowStyle?: (row: T) => string | undefined;
    cell?: Snippet<[T, DataColumn<T>, DataCellContext]>;
    /** Per-column cell snippets, consulted BEFORE `cell` and needing no
     *  `custom: true` flag. A record sidesteps the brand clash that keeps
     *  snippets off the column object. */
    cells?: Record<string, Snippet<[T, DataColumn<T>, DataCellContext]>>;
    /** Custom header content per column (switch on `col.key`; render nothing to fall back to `label`). */
    headerCell?: Snippet<[DataColumn<T>]>;
    /** Per-column header snippets. A filterable column keeps its filter control. */
    headers?: Record<string, Snippet<[DataColumn<T>]>>;
    /** Per-row controls in the sticky trailing actions column. Clicks inside it
     *  never reach `onRowClick`. */
    rowActions?: Snippet<[T]>;
    /** Content of a `groupBy` header row (default: label + row count). */
    groupRow?: Snippet<[string, T[]]>;
    /** One footer cell, per active aggregate (default: the formatted value). */
    footerCell?: Snippet<[DataColumn<T>, AggMode, unknown]>;
    errorContent?: Snippet<[unknown]>;
    /** Replaces the default `emptyMessage` block. */
    empty?: Snippet;
    /** Extra chips appended to the filter-chip bar. */
    chips?: Snippet;
    filterOptionIcon?: Snippet<[string]>;
    toolbar?: Snippet;
    actions?: Snippet;
    /** Page-level view switches (e.g. "Show archived") rendered as the first
     *  section of the ⚙ Table options menu, so a table's toggles live with its
     *  other settings instead of in the page header. */
    options?: Snippet;
    /** Preloaded custom-property definitions and values for a registered primary table. */
    customProperties?: CustomPropertyTableConfig<T>;
    /** Tag scope for the bulk bar's "Tags" action (`stock`/`catalog`/`crm`).
     *  Requires `tagsOf` too — absent either, the action stays hidden. */
    tagScope?: TagScope;
    /** Current MANUAL tag ids on a row (never rule-derived/auto ones — those
     *  stay read-only), for the bulk "Tags" popover's add/remove checkmarks. */
    tagsOf?: (row: T) => string[];
    emptyMessage?: string;
    class?: string;
    style?: string;
  } & Record<string, unknown> = $props();

  // ── `variant` / `chrome` preset resolution ────────────────────────────────
  // Precedence: an explicit per-item prop > `chrome` > the variant preset. That
  // ordering is what lets `variant` stay a pure preset (see its doc comment):
  // nothing here can override a value the caller actually passed.
  const fullVariant = $derived(variant !== 'plain');
  function chromeOn(feature: ChromeFeature, preset: boolean): boolean {
    if (chrome === undefined) return preset;
    if (typeof chrome === 'boolean') return chrome;
    return chrome.includes(feature);
  }
  const searchOn = $derived(searchable ?? chromeOn('search', fullVariant));
  const columnMenuOn = $derived(columnMenu ?? chromeOn('columns', fullVariant));
  const reorderOn = $derived(reorderable ?? chromeOn('reorder', fullVariant));
  const exportOn = $derived(exportable ?? chromeOn('export', false));
  const addOn = $derived(chromeOn('add', true));
  const bulkOn = $derived(chromeOn('bulk', true));

  // ── Geometry ──────────────────────────────────────────────────────────────
  // Public CSS variables on the root element: `--dt-row-h` (row height estimate,
  // also the skeleton row height), `--dt-head-h` (sticky header height) and
  // `--dt-sticky-bg` (the opaque paint behind a frozen column — a sticky cell
  // over transparent background lets the scrolling columns bleed through).
  const ROW_H: Record<Density, number> = { compact: 36, normal: 44, comfortable: 52 };
  const rowH = $derived(ROW_H[density] ?? ROW_H.normal);
  const heightMode = $derived<TableHeight>(height ?? (fullVariant ? 'fill' : 'fit'));
  const fixedHeight = $derived(heightMode === 'fill' || heightMode === 'fit' ? null : heightMode);
  const virtualizeOn = $derived(virtualize ?? (fullVariant || fixedHeight !== null));
  const hasError = $derived(error !== undefined && error !== null);
  const stickyCount = $derived(Math.max(0, Math.trunc(stickyColumns)));

  // ── Org table config (settings/tables) + the synthesized ID column ───────
  const tableDef = $derived(tableId ? TABLE_BY_ID.get(tableId) : undefined);
  const cfg = $derived(tableDef ? resolveTable(tableDef, tableConfig()) : null);
  const idPrefix = $derived(cfg?.idPrefix ?? '');
  // svelte-ignore state_referenced_locally
  let customBundle = $state<CustomPropertyBundle | null>(customProperties?.bundle ?? null);
  let customManagerOpen = $state(false);
  let customManagerSelectedId = $state<string | null>(null);
  let customManagerCreate = $state(false);
  // svelte-ignore state_referenced_locally -- seeded once; the effect below synchronizes later bundles.
  let customManagerDefinitions = $state<CustomPropertyDefinition[]>(
    customProperties?.bundle.definitions ?? [],
  );
  let customDefinitionsLoaded = $state(false);
  let customDefinitionsLoadFailed = $state(false);
  let customProjectionFailed = $state(false);
  // svelte-ignore state_referenced_locally -- scope transitions are handled atomically in the effect below.
  let customScopeKey = $state(customProperties?.scopeKey ?? '');
  const customEnabled = $derived(!!tableDef && !!tableId && !!customProperties && !!customBundle);
  const managerActions = createCustomPropertyManagerActions();
  const valueActions = $derived(
    tableId
      ? createCustomPropertyValueActions(
          tableId as CustomPropertyTableId,
          customProperties?.onrefresh,
        )
      : null,
  );
  const customPreviewRecords = $derived.by(() => {
    const config = customProperties;
    const bundle = customBundle;
    if (!config || !bundle) return [];
    const labelColumn = columnsProp.find(
      (column) =>
        column.accessor &&
        !column.numeric &&
        !column.money &&
        column.type !== 'number' &&
        column.type !== 'boolean' &&
        column.type !== 'date',
    );
    return data
      .flatMap((row) => {
        const id = config.recordId(row);
        if (!id || !Object.hasOwn(bundle.recordAccess, id)) return [];
        const rawLabel = labelColumn?.accessor?.(row);
        const label =
          typeof rawLabel === 'string' && rawLabel.trim()
            ? rawLabel.trim()
            : m.custom_columns_formula_row();
        return [{ id, label, values: bundle.values[id] ?? {} }];
      })
      .slice(0, 20);
  });

  $effect(() => {
    const incoming = customProperties?.bundle;
    if (!incoming) {
      customBundle = null;
      customManagerDefinitions = [];
      customDefinitionsLoaded = false;
      return;
    }
    const previousScope = untrack(() => customScopeKey);
    const previousBundle = untrack(() => customBundle);
    const definitionsLoaded = untrack(() => customDefinitionsLoaded);
    const sameScope = previousScope === customProperties?.scopeKey;
    customScopeKey = customProperties?.scopeKey ?? '';
    if (!sameScope) {
      customDefinitionsLoaded = false;
      customManagerOpen = false;
      customManagerSelectedId = null;
      customProjectionFailed = false;
      customDefinitionsLoadFailed = false;
    }
    customBundle =
      sameScope && previousBundle
        ? {
            ...incoming,
            values: { ...previousBundle.values, ...incoming.values },
            recordAccess: { ...previousBundle.recordAccess, ...incoming.recordAccess },
          }
        : incoming;
    if (!sameScope || !definitionsLoaded) customManagerDefinitions = incoming.definitions;
  });

  const customColumns = $derived.by((): DataColumn<T>[] => {
    if (!customEnabled || !customBundle) return [];
    return customBundle.definitions
      .filter((definition) => !definition.archivedAt)
      .map((definition): DataColumn<T> => {
        const key = customPropertyColumnKey(definition.id);
        const rules = definition.rules;
        const primaryFormula =
          rules.type === 'formula' ? primaryFormulaVariable(rules, definition.id) : null;
        const columnType: CellType =
          rules.type === 'formula'
            ? primaryFormula!.outputType.kind
            : rules.type === 'multi_select'
              ? 'text'
              : rules.type;
        const value = (row: T) => {
          const recordId = customProperties?.recordId(row);
          return recordId
            ? (customBundle?.values[recordId]?.[definition.id]?.effectiveValue ?? null)
            : null;
        };
        const options =
          definition.type === 'select' || definition.type === 'multi_select'
            ? () => {
                const rules = definition.rules;
                if (rules.type !== 'select' && rules.type !== 'multi_select') return [];
                return rules.options
                  .filter((option) => !option.archivedAt)
                  .map((option) => ({ value: option.id, label: option.label }));
              }
            : undefined;
        return {
          key,
          label: definition.label,
          accessor: value,
          custom: true,
          customEditable: definition.type !== 'formula',
          type: columnType,
          numeric: definition.type === 'number' || primaryFormula?.outputType.kind === 'number',
          // TODO(handoff): add global server custom-property sort/filter/export planning;
          // see meta proposal 2026-09-26-hub-custom-columns-next-phases.
          sortable: !server,
          sortFn: server
            ? undefined
            : (a, b) =>
                defaultCmp(
                  customPropertySortValue(definition, value(a)) ?? '',
                  customPropertySortValue(definition, value(b)) ?? '',
                ),
          filter:
            !server && options
              ? {
                  options,
                  match: (row) => {
                    const current = value(row);
                    return Array.isArray(current)
                      ? current
                      : typeof current === 'string'
                        ? current
                        : null;
                  },
                }
              : undefined,
          exportable: !server,
          exportValue: (row) => {
            const raw = value(row);
            return definition.rules.type === 'formula' && typeof raw === 'number'
              ? raw
              : customPropertyDisplay(definition, raw, languageTag(), {
                  yes: m.common_yes(),
                  no: m.common_no(),
                });
          },
          width: 176,
        };
      });
  });
  const columns = $derived.by((): DataColumn<T>[] => {
    const base = [...columnsProp, ...customColumns];
    if (!idColumn) return base;
    const value = idColumn.value;
    const id: DataColumn<T> = {
      key: '__id',
      label: idColumn.label ?? m.data_table_id(),
      accessor: (row) => formatId(idPrefix, value(row)),
      exportValue: (row) => formatId(idPrefix, value(row)),
      cellClass: 'dt-id',
      width: 96,
      sortFn: (a, b) => defaultCmp(value(a) ?? '', value(b) ?? ''),
    };
    return [id, ...base];
  });
  /** Header label — the org override when there is one. */
  const colLabel = (c: DataColumn<T>): string => cfg?.fields.get(c.key)?.label ?? c.label;
  const isTitle = (c: DataColumn<T>) => !!titleColumn && c.key === titleColumn.key;
  // ── Record open mode (page/modal/tray) ────────────────────────────────────
  const OPEN_MODE_LABEL: Record<OpenMode, () => string> = {
    page: m.record_open_page,
    modal: m.record_open_modal,
    tray: m.record_open_tray,
  };
  // Optimistic local override: `openModeFor` re-derives from `page.data`,
  // which the "for me" write below only reaches after its debounce + the
  // next full data load. This gives the SegmentedControl the usual
  // click-and-it-sticks feel without waiting on that round trip.
  let openModeOverride = $state<OpenMode | null>(null);
  const resolvedOpenMode = $derived(openModeOverride ?? openModeFor(tableId, openIn));
  const rowOpenOn = $derived(resolveRowOpen(!!titleColumn, !!onRowClick, rowOpen));
  function titleAnchorClick(href: string) {
    return (e: MouseEvent) => {
      e.stopPropagation();
      peekClick(href, resolvedOpenMode)(e);
    };
  }
  /** Owner directive 2026-09-29: every table-options change is FOR THE VIEWER
   *  ONLY by default — the SegmentedControl always writes the user's own
   *  preference. Applying it org-wide is a separate, explicit action behind
   *  the kebab (`applyOpenModeOrg` below), gated the same way
   *  (`settings:manage`) an admin/manager/owner role grants. */
  const canSwitchOpenModeOrg = $derived(!!tableId && can('settings:manage'));
  const canSwitchOpenMode = $derived(!!tableId);
  function setOpenMode(mode: string) {
    if (!tableId || !isOpenMode(mode)) return;
    openModeOverride = mode;
    syncPreferenceToServer('tableOpenIn', { ...userOpenModes(), [tableId]: mode });
  }
  /** Kebab-only: pushes the CURRENT resolved mode to the org's table config so
   *  every other viewer gets it too. */
  async function applyOpenModeOrg() {
    if (!tableId || !canSwitchOpenModeOrg) return;
    const res = await fetch('/api/tables/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [tableId]: { openIn: resolvedOpenMode } }),
    });
    if (res.ok) await invalidate('app:table-config');
  }

  const acc = (c: DataColumn<T>) =>
    c.accessor ?? ((row: T) => (row as Record<string, unknown>)[c.key]);
  const editableCols = $derived(columns.filter((c) => c.editable));
  const hasEdit = $derived(!!onSaveRow && editableCols.length > 0);
  const editOn = $derived(hasEdit && canEdit && !editDisabled);
  const colType = (c: DataColumn<T>): CellType =>
    c.type ?? (c.numeric || c.money ? 'number' : 'text');
  const colEditable = (c: DataColumn<T>) =>
    editOn && !!c.editable && (cfg?.fields.get(c.key)?.editable ?? true);
  const customCellCanEdit = (c: DataColumn<T>) =>
    canEdit && !editDisabled && !!c.customEditable && (cfg?.fields.get(c.key)?.editable ?? true);
  /** Table-wide switch: this table opted into spreadsheet-style cells at all
   *  (some column is `editable` or `customEditable`), so EVERY cell becomes
   *  selectable — not just the actionable ones (owner directive 2026-09-29:
   *  "every cell is selectable, but not all are editable"). Tables that never
   *  opted into cell editing (plain `onRowClick` lists) are unaffected — row
   *  click keeps working exactly as before. */
  const anyCellEditable = $derived(hasEdit || columns.some((c) => c.customEditable));
  const customDefinition = (key: string) =>
    customBundle?.definitions.find((definition) => customPropertyColumnKey(definition.id) === key);

  // ── Floating bulk bar: "Edit property" reuses the row-save contract for
  //    built-in columns, and the custom-property values API for those ──────
  const bulkEditCols = $derived(
    editOn ? bulkEditableColumns(columns, (key) => cfg?.fields.get(key)?.editable ?? true) : [],
  );
  const bulkEditCustomCols = $derived(
    customEnabled && customBundle && valueActions
      ? customColumns.filter((c) => customDefinition(c.key)?.rules.type !== 'formula')
      : [],
  );
  const bulkEditAllCols = $derived([...bulkEditCols, ...bulkEditCustomCols]);
  let bulkEditKey = $state<string | null>(null);
  let bulkEditValue = $state('');
  /** Staged option ids for a custom select/multi_select bulk edit. */
  let bulkEditOptions = $state<string[]>([]);
  let bulkEditApplying = $state(false);
  const resolvedBulkEditKey = $derived(bulkEditKey ?? bulkEditAllCols[0]?.key ?? null);
  const bulkEditColumn = $derived(
    bulkEditAllCols.find((c) => c.key === resolvedBulkEditKey) ?? null,
  );
  const bulkEditCustomDef = $derived(
    bulkEditColumn ? (customDefinition(bulkEditColumn.key) ?? null) : null,
  );
  const showBulkTags = $derived(!!tagScope && !!tagsOf);
  const showBulkBar = $derived(
    bulkOn &&
      selectedIds.size > 0 &&
      (!!bulkActions?.length || bulkEditAllCols.length > 0 || showBulkTags),
  );

  function resetBulkEditDraft() {
    bulkEditValue = '';
    bulkEditOptions = [];
  }

  async function applyBulkEditBuiltin(column: DataColumn<T>) {
    const persist = onSaveRow;
    if (!persist) return;
    const rows = data.filter((r) => selectedIds.has(getRowId(r)));
    const jobs = bulkEditJobs(rows, column.key, bulkEditValue).map(({ row, changes }) => ({
      id: getRowId(row),
      row,
      changes,
    }));
    if (!jobs.length) return;
    const retainUnsent = jobs.map((j) => saves.prepareAdmissionFailure(j.id, j.changes));
    const execute = async (context?: CommandContext): Promise<CommandOutcome<RowOutcome[]>> => {
      const results = await Promise.all(
        jobs.map((j) =>
          saves.save(
            j.id,
            j.row,
            canonicalDraft({ row: j.row, id: j.id }),
            j.changes,
            persist,
            context ? { ...context, acknowledge: () => {} } : undefined,
          ),
        ),
      );
      return completeRowSaves(results, onSaveComplete, context);
    };
    const outcome = await runDraftCommand(actionRuntime, 'table.bulkEdit', execute, () => {
      for (const retain of retainUnsent) retain();
    });
    if (outcome.status === 'succeeded' || outcome.status === 'committed-refreshing') {
      toastSuccess(m.data_table_bulk_edit_done({ n: jobs.length }));
      resetBulkEditDraft();
    } else if (outcome.status === 'partial') {
      const ok = outcome.value.filter(
        (r) => r.status === 'succeeded' || r.status === 'committed-refreshing',
      ).length;
      toastError(m.data_table_bulk_edit_partial({ ok, failed: jobs.length - ok }));
    } else {
      toastError(m.data_table_bulk_edit_failed());
    }
  }

  function parseCustomBulkValue(definition: CustomPropertyDefinition): CustomPropertyValue {
    if (definition.type === 'number') return bulkEditValue === '' ? null : Number(bulkEditValue);
    if (definition.type === 'boolean')
      return bulkEditValue === '' ? null : bulkEditValue === 'true';
    if (definition.type === 'select') return bulkEditOptions[0] ?? null;
    if (definition.type === 'multi_select') return bulkEditOptions;
    return bulkEditValue === '' ? null : bulkEditValue;
  }

  async function applyBulkEditCustom(definition: CustomPropertyDefinition) {
    if (!customProperties || !customBundle || !valueActions) return;
    const valid = validateCustomPropertyValue(definition.rules, parseCustomBulkValue(definition));
    if (!valid.ok) {
      toastError(m.custom_columns_invalid_value());
      return;
    }
    const rows = data.filter((r) => selectedIds.has(getRowId(r)));
    const plan = planCustomBulkEdit(
      rows,
      (r) => customProperties?.recordId(r),
      customBundle.recordAccess,
      (id) => customBundle?.values[id]?.[definition.id]?.version ?? 0,
    );
    if (!plan.eligible.length) {
      toastError(m.data_table_bulk_edit_failed());
      return;
    }
    const results = await Promise.allSettled(
      plan.eligible.map((t) => valueActions.save(definition, t.recordId, valid.value, t.version)),
    );
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') confirmCustomCell(plan.eligible[i]!.recordId, r.value.cell);
    }
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const skipped = plan.skipped + (plan.eligible.length - ok);
    if (skipped > 0) {
      toastError(m.data_table_bulk_edit_done_skipped({ ok, skipped }));
    } else {
      toastSuccess(m.data_table_bulk_edit_done({ n: ok }));
    }
    resetBulkEditDraft();
  }

  async function applyBulkEdit() {
    const column = bulkEditColumn;
    if (!column || bulkEditApplying) return;
    bulkEditApplying = true;
    try {
      if (bulkEditCustomDef) await applyBulkEditCustom(bulkEditCustomDef);
      else await applyBulkEditBuiltin(column);
    } finally {
      bulkEditApplying = false;
    }
  }

  // ── Floating bulk bar: "Tags" (add/remove across the selection) ──────────
  let bulkTagRegistry = $state<CalTag[]>([]);
  let bulkTagRegistryLoaded = $state(false);
  let bulkTagAdd = $state<Set<string>>(new Set());
  let bulkTagRemove = $state<Set<string>>(new Set());
  let bulkTagsApplying = $state(false);
  const bulkTagRowIds = $derived(
    showBulkTags ? data.filter((r) => selectedIds.has(getRowId(r))).map((r) => tagsOf!(r)) : [],
  );
  const bulkTagSelected = $derived(
    new Set(
      bulkTagRegistry
        .map((t) => t.id)
        .filter(
          (id) =>
            bulkTagAdd.has(id) ||
            (tagBulkState(bulkTagRowIds, id) === 'all' && !bulkTagRemove.has(id)),
        ),
    ),
  );
  function toggleBulkTag(id: string) {
    if (bulkTagAdd.has(id)) {
      bulkTagAdd = new Set([...bulkTagAdd].filter((v) => v !== id));
      return;
    }
    if (bulkTagRemove.has(id)) {
      bulkTagRemove = new Set([...bulkTagRemove].filter((v) => v !== id));
      return;
    }
    if (tagBulkIntent(tagBulkState(bulkTagRowIds, id)) === 'remove') {
      bulkTagRemove = new Set([...bulkTagRemove, id]);
    } else {
      bulkTagAdd = new Set([...bulkTagAdd, id]);
    }
  }
  async function loadBulkTagRegistry(): Promise<CalTag[]> {
    if (!tagScope) return [];
    const res = await fetch(`/api/tags?scope=${tagScope}`);
    if (!res.ok) throw new Error(String(res.status));
    return ((await res.json()) as { tags: CalTag[] }).tags;
  }
  $effect(() => {
    if (!showBulkTags || bulkTagRegistryLoaded) return;
    bulkTagRegistryLoaded = true;
    void loadBulkTagRegistry()
      .then((tags) => (bulkTagRegistry = tags))
      .catch(() => (bulkTagRegistryLoaded = false));
  });
  async function applyBulkTags() {
    if (!tagScope || bulkTagsApplying || (!bulkTagAdd.size && !bulkTagRemove.size)) return;
    bulkTagsApplying = true;
    try {
      const ids = [...selectedIds];
      await bulkLinkTags(tagScope, ids, [...bulkTagAdd], [...bulkTagRemove]);
      toastSuccess(m.data_table_bulk_tags_done({ n: ids.length }));
      bulkTagAdd = new Set();
      bulkTagRemove = new Set();
      await onSaveComplete?.();
    } catch {
      toastError(m.data_table_bulk_tags_failed());
    } finally {
      bulkTagsApplying = false;
    }
  }

  function confirmCustomCell(recordId: string, cell: CustomPropertyValueCell) {
    if (!customBundle) return;
    customBundle = {
      ...customBundle,
      values: {
        ...customBundle.values,
        [recordId]: { ...customBundle.values[recordId], [cell.propertyId]: cell },
      },
    };
  }

  function changeCustomDefinition(definition: CustomPropertyDefinition) {
    customManagerDefinitions = customManagerDefinitions.some((entry) => entry.id === definition.id)
      ? customManagerDefinitions.map((entry) => (entry.id === definition.id ? definition : entry))
      : [...customManagerDefinitions, definition];
    if (!customBundle) return;
    customBundle = {
      ...customBundle,
      definitions: definition.archivedAt
        ? customBundle.definitions.filter((entry) => entry.id !== definition.id)
        : customBundle.definitions.some((entry) => entry.id === definition.id)
          ? customBundle.definitions.map((entry) =>
              entry.id === definition.id ? definition : entry,
            )
          : [...customBundle.definitions, definition],
    };
    void refreshCustomProjection();
  }

  async function refreshCustomProjection() {
    if (!tableId || !customProperties || !customBundle) return;
    const scope = customProperties.scopeKey;
    customProjectionFailed = false;
    const recordIds = [
      ...new Set(data.map(customProperties.recordId).filter((id): id is string => !!id)),
    ];
    try {
      const batches: CustomPropertyBundle[] = [];
      for (let index = 0; index < recordIds.length; index += CUSTOM_PROPERTY_QUERY_RECORDS_MAX) {
        batches.push(
          await loadCustomPropertyBundle(
            tableId as CustomPropertyTableId,
            recordIds.slice(index, index + CUSTOM_PROPERTY_QUERY_RECORDS_MAX),
          ),
        );
      }
      if (customProperties.scopeKey !== scope || customScopeKey !== scope) return;
      const refreshed = batches[0] ?? customBundle;
      customBundle = {
        ...refreshed,
        values: Object.assign({}, ...batches.map((bundle) => bundle.values)),
        recordAccess: Object.assign({}, ...batches.map((bundle) => bundle.recordAccess)),
      };
      customManagerDefinitions = customManagerDefinitions.map(
        (entry) => refreshed.definitions.find((definition) => definition.id === entry.id) ?? entry,
      );
      await customProperties.onrefresh?.();
    } catch {
      if (customProperties.scopeKey === scope && customScopeKey === scope) {
        customProjectionFailed = true;
      }
    }
  }

  async function openCustomManager(selectedId: string | null = null, create = false) {
    if (!tableId || !customEnabled) return;
    customManagerSelectedId = selectedId;
    customManagerCreate = create;
    customManagerOpen = true;
    if (customDefinitionsLoaded) return;
    const scope = customProperties?.scopeKey;
    customDefinitionsLoadFailed = false;
    try {
      const result = await loadCustomPropertyDefinitions(tableId as CustomPropertyTableId);
      if (!scope || customProperties?.scopeKey !== scope || customScopeKey !== scope) return;
      customManagerDefinitions = result.definitions;
      customDefinitionsLoaded = true;
      customDefinitionsLoadFailed = false;
    } catch {
      if (scope && customProperties?.scopeKey === scope && customScopeKey === scope) {
        customDefinitionsLoadFailed = true;
      }
    }
  }
  const expandEnabled = $derived(!!getSubRows || !!expandedContent);

  // ── Persisted layout: visibility, order, widths, wrap, aggregates ─────────
  // svelte-ignore state_referenced_locally
  let hidden = $state<Set<string>>(
    new Set(
      columns.filter((c) => cfg?.fields.get(c.key)?.hidden ?? c.defaultHidden).map((c) => c.key),
    ),
  );
  // svelte-ignore state_referenced_locally
  let order = $state<string[]>(columns.map((c) => c.key));
  let widths = $state<Record<string, number>>({});
  let wrap = $state<Set<string>>(new Set());
  // Per-column aggregates are NON-exclusive: a value column can show sum + avg +
  // count at once, each as its own icon-prefixed line in the header.
  let aggregates = $state<Record<string, AggMode[]>>({});
  let colMenuOpen = $state(false);
  let colMenuRoot = $state<HTMLDivElement | null>(null);

  $effect(() => {
    const keys = columns.map((c) => c.key);
    untrack(() => {
      const kept = order.filter((k) => keys.includes(k));
      const added = keys.filter((k) => !kept.includes(k));
      if (kept.length !== order.length || added.length) order = [...kept, ...added];
    });
  });

  $effect(() => {
    if (!browser || !storageKey) return;
    const raw = localStorage.getItem(`dt:${storageKey}`);
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as {
        hidden?: string[];
        order?: string[];
        widths?: Record<string, number>;
        wrap?: string[];
        aggregates?: Record<string, AggMode | AggMode[]>;
      };
      const keys = new Set(columns.map((c) => c.key));
      if (s.hidden) hidden = new Set(s.hidden.filter((k) => keys.has(k)));
      if (s.order) {
        const kept = s.order.filter((k) => keys.has(k));
        order = [...kept, ...columns.map((c) => c.key).filter((k) => !kept.includes(k))];
      }
      if (s.widths)
        widths = Object.fromEntries(Object.entries(s.widths).filter(([k]) => keys.has(k)));
      if (s.wrap) wrap = new Set(s.wrap.filter((k) => keys.has(k)));
      if (s.aggregates)
        aggregates = Object.fromEntries(
          Object.entries(s.aggregates)
            .filter(([k]) => keys.has(k))
            .map(([k, v]) => [k, Array.isArray(v) ? v : [v]]), // coerce old single-mode format
        );
    } catch {
      /* ignore corrupt layout */
    }
  });
  function persist() {
    if (browser && storageKey)
      localStorage.setItem(
        `dt:${storageKey}`,
        JSON.stringify({ hidden: [...hidden], order, widths, wrap: [...wrap], aggregates }),
      );
  }

  const byKey = $derived(new Map(columns.map((c) => [c.key, c])));
  const orderedColumns = $derived(
    order.map((k) => byKey.get(k)).filter((c): c is DataColumn<T> => !!c),
  );
  const visibleColumns = $derived(orderedColumns.filter((c) => !hidden.has(c.key)));

  function toggleHidden(key: string) {
    const next = new Set(hidden);
    next.has(key) ? next.delete(key) : next.add(key);
    hidden = next;
    persist();
  }

  // ── Column widths (fixed layout → resizing one column never moves the rest;
  //    the table grows past the viewport and scrolls horizontally) ──────────
  function defaultWidth(c: DataColumn<T>, first: boolean): number {
    if (c.width) return c.width;
    if (first) return 220;
    if (c.align === 'right') return 120;
    return 160;
  }
  const dataWidth = (c: DataColumn<T>, i: number) => widths[c.key] ?? defaultWidth(c, i === 0);
  const SEL_W = 40,
    EXP_W = 38;
  // A `fill` column absorbs leftover width, so the trailing spacer col/cells are dropped.
  const hasFill = $derived(visibleColumns.some((c) => c.fill));
  const totalWidth = $derived(
    (selectable ? SEL_W : 0) +
      (expandEnabled ? EXP_W : 0) +
      visibleColumns.reduce((s, c, i) => s + dataWidth(c, i), 0),
  );
  /** Trailing sticky actions column, when `rowActions` is passed. */
  const ACT_W = 76;
  /** Trailing add-column affordance (Notion-style): NOT sticky, scrolls with
   *  the last data column, always the table's true last column. */
  const ADD_COL_W = 120;
  /** `left` for each frozen leading data column — cumulative over the gutters
   *  and the frozen columns before it (fixed table layout makes this exact). */
  const stickyLefts = $derived.by(() => {
    if (stickyCount <= 0) return [] as number[];
    let offset = (selectable ? SEL_W : 0) + (expandEnabled ? EXP_W : 0);
    const out: number[] = [];
    for (let i = 0; i < Math.min(stickyCount, visibleColumns.length); i++) {
      out.push(offset);
      offset += dataWidth(visibleColumns[i], i);
    }
    return out;
  });
  const hasStickyCells = $derived(stickyLefts.length > 0 || !!rowActions);

  // ── Column reorder ───────────────────────────────────────────────────────
  function moveColumn(key: string, targetKey: string, side: 'before' | 'after') {
    if (key === targetKey) return;
    const next = order.filter((k) => k !== key);
    let idx = next.indexOf(targetKey);
    if (idx < 0) return;
    if (side === 'after') idx += 1;
    next.splice(idx, 0, key);
    order = next;
    persist();
  }

  // Header drag-reorder: pointer-based, horizontal-only. The header AND its
  // column cells translate with the cursor; a drop indicator marks the gap.
  let theadEl: HTMLTableSectionElement | null = $state(null);
  let tableEl: HTMLTableElement | null = $state(null);
  let hdrDrag = $state<{ key: string; startX: number; dx: number; active: boolean } | null>(null);
  let dropTarget = $state<{ key: string; side: 'before' | 'after' } | null>(null);

  function onHeaderPointerDown(c: DataColumn<T>, e: PointerEvent) {
    if (!reorderOn || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.dt-resize')) return;
    hdrDrag = { key: c.key, startX: e.clientX, dx: 0, active: false };
    window.addEventListener('pointermove', onHeaderPointerMove);
    window.addEventListener('pointerup', onHeaderPointerUp);
  }
  function onHeaderPointerMove(e: PointerEvent) {
    if (!hdrDrag) return;
    const dx = e.clientX - hdrDrag.startX;
    if (!hdrDrag.active && Math.abs(dx) < 4) return;
    hdrDrag = { ...hdrDrag, dx, active: true };
    // Scan the OTHER headers (skip the dragged one — its rect follows the
    // cursor, which would otherwise block rightward drops).
    const ths = theadEl?.querySelectorAll<HTMLElement>('th[data-col]');
    let target: { key: string; side: 'before' | 'after' } | null = null;
    if (ths) {
      for (const th of ths) {
        const key = th.dataset.col!;
        if (key === hdrDrag.key) continue;
        const r = th.getBoundingClientRect();
        if (e.clientX < r.left) {
          if (!target) target = { key, side: 'before' };
          break;
        }
        target = { key, side: e.clientX < r.left + r.width / 2 ? 'before' : 'after' };
        if (e.clientX <= r.right) break;
      }
    }
    dropTarget = target;
  }
  function onHeaderPointerUp() {
    window.removeEventListener('pointermove', onHeaderPointerMove);
    window.removeEventListener('pointerup', onHeaderPointerUp);
    const drag = hdrDrag;
    const drop = dropTarget;
    hdrDrag = null;
    dropTarget = null;
    if (drag?.active) {
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (drop) moveColumn(drag.key, drop.key, drop.side);
    }
  }

  // ── Column resize ─────────────────────────────────────────────────────────
  let resizeKey = $state<string | null>(null);
  function onResizeDown(c: DataColumn<T>, i: number, e: PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const startW = dataWidth(c, i);
    const startX = e.clientX;
    resizeKey = c.key;
    const move = (ev: PointerEvent) => {
      widths = { ...widths, [c.key]: Math.max(64, Math.round(startW + (ev.clientX - startX))) };
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      resizeKey = null;
      persist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  // Double-click the resize handle → fit the column to its content. Measuring
  // the live cells' scrollWidth doesn't work: when a custom cell's INNER
  // wrapper clips for itself (e.g. a `truncate` div sized by the td), the
  // td's scrollWidth is capped near its current width, so every dblclick only
  // crept a few px wider — forever. Instead, clone each mounted cell's content
  // into an unconstrained shrink-to-fit probe, take the widest natural width,
  // and pin the column to it (+ the cell's own padding). Idempotent: the probe
  // is independent of the current column width, so a second dblclick re-measures
  // to the same value. Only mounted cells are measurable (virtualized rows
  // off-screen aren't in the DOM) — pre-existing behavior.
  function autoFitColumn(c: DataColumn<T>, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!tableEl) return;
    const cells = tableEl.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(c.key)}"]`);
    if (!cells.length) return;
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;width:max-content;white-space:nowrap;';
    tableEl.parentElement?.appendChild(probe);
    let max = 0;
    for (const cell of cells) {
      const cs = getComputedStyle(cell);
      probe.style.font = cs.font; // clones lose the table's inherited typography
      probe.replaceChildren(...[...cell.childNodes].map((n) => n.cloneNode(true)));
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      max = Math.max(max, probe.getBoundingClientRect().width + pad);
    }
    probe.remove();
    if (max > 0) {
      widths = { ...widths, [c.key]: Math.min(640, Math.max(64, Math.ceil(max) + 2)) };
      persist();
    }
  }

  // ── Menu drag-reorder (drag a column row up/down; reflects table order) ────
  let menuDragKey = $state<string | null>(null);
  function onMenuDrop(targetKey: string) {
    if (menuDragKey && menuDragKey !== targetKey) {
      const from = order.indexOf(menuDragKey);
      const to = order.indexOf(targetKey);
      if (from > -1 && to > -1) moveColumn(menuDragKey, targetKey, from < to ? 'after' : 'before');
    }
    menuDragKey = null;
  }

  // ── Header context menu (wrap / sort / Filter▸ / Aggregate▸) ──────────────
  let ctxMenu = $state<{ key: string; x: number; y: number; flip: boolean } | null>(null);
  let ctxMenuRoot = $state<HTMLDivElement | null>(null);
  /** Which nested flyout is open (hover or click), or `null` for none. Reset
   *  whenever the parent menu closes. */
  let ctxSub = $state<'filter' | 'aggregate' | null>(null);
  function openCtx(c: DataColumn<T>, e: MouseEvent) {
    e.preventDefault();
    // A submenu flyout is ~12rem wide, same as the parent — flip it to the
    // LEFT of the parent row instead of off the right edge of the viewport.
    const flip = browser && e.clientX + 192 * 2 > window.innerWidth;
    ctxMenu = { key: c.key, x: e.clientX, y: e.clientY, flip };
    ctxSub = null;
  }
  function closeCtx() {
    ctxMenu = null;
    ctxSub = null;
  }
  // Outside-pointerdown + Escape dismissal for the column menu and the header
  // context menu — see the "no fixed backdrop" note on `.col-wrap` above.
  function onDocPointerDown(e: PointerEvent) {
    const t = e.target as Node;
    if (colMenuOpen && colMenuRoot && !colMenuRoot.contains(t)) colMenuOpen = false;
    if (ctxMenu && ctxMenuRoot && !ctxMenuRoot.contains(t)) closeCtx();
  }
  function onDocKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (colMenuOpen) colMenuOpen = false;
    if (ctxMenu) closeCtx();
  }
  // A right-click elsewhere while the ctx menu is open closes it — UNLESS the
  // click is on another header cell (which opens its OWN ctx menu via
  // `openCtx`; closing here too would immediately clobber that new one).
  function onDocContextMenu(e: MouseEvent) {
    if (!ctxMenu) return;
    const t = e.target as HTMLElement;
    if (ctxMenuRoot?.contains(t)) return;
    if (t.closest('th.dt-th')) return;
    closeCtx();
  }
  function toggleWrap(key: string) {
    const next = new Set(wrap);
    next.has(key) ? next.delete(key) : next.add(key);
    wrap = next;
    persist();
  }
  function toggleAggregate(key: string, mode: AggMode) {
    const cur = aggregates[key] ?? [];
    const has = cur.includes(mode);
    const nextList = has ? cur.filter((x) => x !== mode) : [...cur, mode];
    const next = { ...aggregates };
    if (nextList.length) next[key] = nextList;
    else delete next[key];
    aggregates = next;
    persist();
  }
  // Auto-detect numeric columns by sampling.
  const numericKeys = $derived.by(() => {
    const set = new Set<string>();
    for (const c of columns) {
      if (c.numeric) {
        set.add(c.key);
        continue;
      }
      for (let i = 0; i < Math.min(data.length, 25); i++) {
        const v = acc(c)(data[i]);
        if (v == null || v === '') continue;
        if (typeof v === 'number' && Number.isFinite(v)) set.add(c.key);
        break;
      }
    }
    return set;
  });
  /** The aggregate as a NUMBER (what `footerCell` receives); `null` when there
   *  is nothing to aggregate. */
  function aggRaw(c: DataColumn<T>, mode: AggMode): number | null {
    if (mode === 'count') return view.length;
    const nums = view.map((r) => Number(acc(c)(r))).filter((n) => Number.isFinite(n));
    if (!nums.length) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    return mode === 'sum' ? sum : sum / nums.length;
  }
  function aggOne(c: DataColumn<T>, mode: AggMode): string {
    const out = aggRaw(c, mode);
    if (out === null) return '—';
    if (mode === 'count') return out.toLocaleString();
    // A money column's aggregate is money too — never a bare number.
    if (c.money) return formatMoney(out, typeof c.money === 'string' ? c.money : 'PEN');
    return out.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  // All active aggregates for a column, in a stable order, with their values.
  const AGG_ORDER: AggMode[] = ['sum', 'avg', 'count'];
  function aggList(c: DataColumn<T>): { mode: AggMode; value: string; raw: number | null }[] {
    const active = aggregates[c.key];
    if (!active?.length) return [];
    return AGG_ORDER.filter((mode) => active.includes(mode)).map((mode) => ({
      mode,
      value: aggOne(c, mode),
      raw: aggRaw(c, mode),
    }));
  }

  // ── Search ───────────────────────────────────────────────────────────────
  const rowText = (row: T) =>
    searchFields ? searchFields(row) : columns.map((c) => String(acc(c)(row) ?? '')).join(' ');

  // ── Column filters (one FilterValue per filterable column) ────────────────
  // `enum` (a value multi-select) is the default kind and the only one the table
  // shipped before; `text`/`number`/`date` render inputs in the same popover.
  function requery() {
    if (!server) return;
    serverPage = 1;
    lastInfiniteRequest = 0;
    emitServerQuery();
  }
  function filterSet(key: string): Set<string> {
    const value = filters[key];
    return value?.kind === 'enum' ? new Set(value.values) : new Set();
  }
  /** An inert value is DELETED, so `filters` only ever holds live selections. */
  function setFilterValue(key: string, value: FilterValue | null) {
    const next = { ...filters };
    if (!value || !isFilterActive(value)) delete next[key];
    else next[key] = value;
    filters = next;
    requery();
  }
  function setFilter(key: string, s: Set<string>) {
    setFilterValue(key, { kind: 'enum', values: [...s] });
  }
  /** Chip keys shown even while inert (just picked from the "+ Filter" menu,
   *  operand not entered yet) — normal chip visibility is `isFilterActive`. */
  let openChips = $state<string[]>([]);
  /** Per-chip popover open flag, keyed by column key (bound into by each
   *  `FilterChip` instance's `bind:open`). */
  let chipOpenState = $state<Record<string, boolean>>({});
  let advancedOpen = $state(false);

  function clearFilters() {
    filters = {};
    advanced = null;
    openChips = [];
    chipOpenState = {};
    requery();
  }
  const filterKindOf = (c: DataColumn<T>): FilterKind =>
    c.filter?.kind ??
    (c.filter?.options
      ? 'enum'
      : c.type === 'boolean'
        ? 'boolean'
        : c.type === 'number' || c.numeric || c.money
          ? 'number'
          : c.type === 'date'
            ? 'date'
            : c.type === 'select' || c.filter
              ? 'enum'
              : 'text');
  /** Enum option list for the chip / advanced builder: the column's own
   *  `filter.options()` when given, else distinct values seen in `data`
   *  (capped, since an unbounded scan over an unfiltered enum is a real cost
   *  on a large table). */
  function enumOptionsOf(c: DataColumn<T>): { value: string; label: string }[] {
    if (c.filter?.options) return c.filter.options();
    if (c.options) return c.options();
    const match = c.filter?.match ?? acc(c);
    const seen = new Set<string>();
    for (const row of data) {
      const raw = match(row);
      for (const v of Array.isArray(raw) ? raw : [raw]) {
        if (v != null && v !== '') seen.add(String(v));
        if (seen.size >= 200) break;
      }
      if (seen.size >= 200) break;
    }
    return [...seen].sort().map((v) => ({ value: v, label: v }));
  }
  /** Column metadata for the "+ Filter" menu, chips, and advanced builder.
   *  EVERY column is filterable here (Notion lists every property); a column's
   *  `filter` config only decides whether it ALSO gets a header popover. */
  const filterColumnsMeta = $derived.by((): FilterColumnMeta[] =>
    columns.map((c) => {
      const kind = filterKindOf(c);
      return {
        key: c.key,
        label: colLabel(c),
        kind,
        options: kind === 'enum' ? enumOptionsOf(c) : undefined,
      };
    }),
  );
  /** Resolves a column key to its match function for `matchesGroup` — an
   *  unknown key is inert, never hiding rows. */
  function matchOf(key: string): ((row: unknown) => unknown) | null {
    const c = byKey.get(key);
    if (!c) return null;
    const fn = c.filter?.match ?? acc(c);
    return (row: unknown) => fn(row as T);
  }
  function pickFilter(key: string) {
    if (!openChips.includes(key)) openChips = [...openChips, key];
    chipOpenState = { ...chipOpenState, [key]: true };
  }
  /** Header context menu's Filter▸ submenu: seed the column's filter value
   *  with a specific operator preselected (instead of the kind's default) and
   *  open its chip — used when the row picked isn't the plain "Filter…" one. */
  function pickFilterOp(key: string, kind: FilterKind, op: string) {
    filters = { ...filters, [key]: { ...emptyFilter(kind), op } as FilterValue };
    pickFilter(key);
  }
  function removeChip(key: string) {
    setFilterValue(key, null);
    openChips = openChips.filter((k) => k !== key);
    if (key in chipOpenState) {
      const next = { ...chipOpenState };
      delete next[key];
      chipOpenState = next;
    }
  }
  function openAdvanced() {
    const first = filterColumnsMeta[0];
    if (!first) return;
    advanced = { id: newId(), logic: 'and', items: [emptyRule(first.key, first.kind)] };
    advancedOpen = true;
  }
  const advancedActive = $derived(!!advanced && advanced.items.length > 0);
  /** Only shown when the caller declared at least one filterable column and
   *  the table isn't a `plain`-variant embed. */
  const filterBarOn = $derived(filterBar ?? chromeOn('filter', fullVariant));

  // ── Sort (multi-column; one entry = the historical single sort) ────────────
  const sortOf = (key: string) => sort.find((s) => s.key === key) ?? null;
  /** The primary sort — what a single-key server API and header arrows read. */
  const primarySort = $derived(sort[0] ?? null);
  function applySort(next: { key: string; dir: 'asc' | 'desc' }[]) {
    // Over the cap the OLDEST sort is dropped, so the newest click always lands.
    const cap = Math.max(1, Math.trunc(maxSort));
    sort = next.length > cap ? next.slice(next.length - cap) : next;
    requery();
  }
  function setSort(c: DataColumn<T>, dir: 'asc' | 'desc', append = false) {
    if (c.sortable === false) return;
    if (!append || maxSort <= 1) {
      applySort([{ key: c.key, dir }]);
      return;
    }
    const at = sort.findIndex((s) => s.key === c.key);
    if (at < 0) {
      applySort([...sort, { key: c.key, dir }]);
      return;
    }
    const next = [...sort];
    next[at] = { key: c.key, dir };
    applySort(next);
  }
  function toggleSort(c: DataColumn<T>, append = false) {
    if (c.sortable === false) return;
    const current = sortOf(c.key);
    setSort(
      c,
      current ? (current.dir === 'asc' ? 'desc' : 'asc') : c.align === 'right' ? 'desc' : 'asc',
      append,
    );
  }

  // ── Server mode (opt-in, spec 2026-08-13 §S4) ────────────────────────────
  // The table renders `data` as-is and only ever asks the caller for the next
  // page via `onQuery` — it never filters/sorts/slices locally. `sortKey` /
  // `sortDir` / `filters` above are still tracked (for header arrows and the
  // enum-filter UI) but no longer feed `view`.
  //
  // + happy-dom crashes mounting ANY @minion-stack/ui Button.svelte instance
  // here (`Cannot read properties of null (reading 'Symbol(parentNode)')` in
  // Button.svelte's <svelte:element> insertion, node_modules/happy-dom's
  // `Node.nextSibling` getter) — confirmed independent of this diff (repro on
  // a bare column with no server mode at all). Separately, `view.length > 0`
  // rows never render in tests at all: `rowVirt` requires `browser` from
  // `$app/environment`, stubbed permanently `false` in
  // src/server/test-utils/env-stubs/app-environment.ts, so the `{:else if
  // rowVirt}` branch is always skipped with no `{:else}` fallback. Fixing
  // either is a repo-wide test-infra gap, not a DataTable-only fix — logged in
  // the meta-repo proposals ledger (2026-08-20-hub-datatable-server-mode-test-gap).
  // svelte-ignore state_referenced_locally
  let serverPage = $state(1);
  // svelte-ignore state_referenced_locally
  let serverPageSize = $state(server?.pageSize ?? data.length);
  function emitServerQuery() {
    if (!server) return;
    const live = Object.entries(filters).filter(([, value]) => isFilterActive(value));
    server.onQuery({
      search,
      sort: primarySort,
      sorts: [...sort],
      filters: Object.fromEntries(live.map(([k, value]) => [k, filterToParam(value)])),
      filterValues: Object.fromEntries(live),
      page: serverPage,
      pageSize: serverPageSize || data.length,
    });
  }
  function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
    let t: ReturnType<typeof setTimeout>;
    return (...a: A) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }
  const emitSearchQuery = debounce(() => {
    serverPage = 1;
    lastInfiniteRequest = 0;
    emitServerQuery();
  }, 300);
  function goToServerPage(p: number) {
    if (!server) return;
    serverPage = Math.max(1, p);
    lastInfiniteRequest = 0;
    emitServerQuery();
  }
  // ── Infinite scroll (server.infinite) ────────────────────────────────────
  // Nearing the bottom requests the NEXT page once; the caller appends rows.
  // `lastInfiniteRequest` stops repeat requests while the fetch is in flight
  // and is reset by every path that returns to page 1 (search/filter/sort).
  let lastInfiniteRequest = 0;
  function maybeRequestNextPage() {
    if (!server?.infinite || server.loading || !wrapperEl) return;
    if (data.length >= (server.total ?? 0)) return;
    const el = wrapperEl;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 600) return;
    const next = Math.floor(data.length / serverPageCount) + 1;
    if (next <= 1 || next === lastInfiniteRequest) return;
    lastInfiniteRequest = next;
    serverPage = next;
    emitServerQuery();
  }
  const serverPageCount = $derived(serverPageSize || data.length || 1);
  const serverCanPrev = $derived(serverPage > 1);
  const serverCanNext = $derived(serverPage * serverPageCount < (server?.total ?? 0));
  const serverRangeStart = $derived(
    (server?.total ?? 0) === 0 ? 0 : (serverPage - 1) * serverPageCount + 1,
  );
  const serverRangeEnd = $derived(Math.min(serverPage * serverPageCount, server?.total ?? 0));
  function defaultCmp(a: unknown, b: unknown): number {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  // ── Pipeline: search → column filters → advanced tree → sort ────────────
  // Server mode: the caller already applied search/filter/sort/page — `data`
  // IS the view. Re-deriving here would double-apply the local pipeline on
  // top of an already-scoped page (and silently reorder an already-sorted one).
  // `advanced` is likewise IGNORED in server mode (ledger #1: no server-side
  // parser for the rule tree yet) — the "+ Filter" menu hides "Add advanced
  // filter" there too, so a server table can never even populate it.
  const view = $derived.by(() => {
    if (server) return data;
    const q = search.trim().toLowerCase();
    let list = data;
    if (q) list = list.filter((row) => rowText(row).toLowerCase().includes(q));
    for (const c of columns) {
      const value = filters[c.key];
      if (!isFilterActive(value)) continue;
      // `?? ''` keeps the pre-2026-09-28 behavior where a null value matched an
      // empty-string option instead of dropping out of every bucket.
      const match = c.filter?.match ?? ((row: T) => acc(c)(row) ?? '');
      list = list.filter((row) => matchesFilter(value, match(row)));
    }
    if (advanced) {
      const group = advanced;
      list = list.filter((row) => matchesGroup(group, row, matchOf));
    }
    // Multi-sort applies in precedence order: the first entry decides, later
    // entries only break its ties.
    const active = sort
      .map((s) => ({ col: byKey.get(s.key), dir: s.dir }))
      .filter((s): s is { col: DataColumn<T>; dir: 'asc' | 'desc' } => !!s.col);
    if (active.length) {
      list = [...list].sort((a, b) => {
        for (const { col, dir } of active) {
          const cmp = col.sortFn ?? ((x: T, y: T) => defaultCmp(acc(col)(x), acc(col)(y)));
          const result = (dir === 'asc' ? 1 : -1) * cmp(a, b);
          if (result !== 0) return result;
        }
        return 0;
      });
    }
    return list;
  });

  // A real filter (search text, a column filter, or the advanced tree) is
  // active — as opposed to the windowing that always caps the render count.
  // Only then is "showing N of M" meaningful; unfiltered, the count is just
  // the total row count.
  const anyColumnFilter = $derived(
    columns.some((c) => isFilterActive(filters[c.key])) || advancedActive,
  );
  const filterActive = $derived(search.trim().length > 0 || anyColumnFilter);
  // Content-keyed signatures: a bindable prop can be handed a fresh-but-equal
  // object on any re-render, and an IDENTITY check would then read as "the user
  // changed the query" and yank the scroll position back to the top.
  const sortSignature = $derived(sort.map((s) => `${s.key}:${s.dir}`).join(','));
  const filterSignature = $derived(
    Object.entries(filters)
      .filter(([, value]) => isFilterActive(value))
      .map(([key, value]) => `${key}=${filterToParam(value)}`)
      .sort()
      .join('&') + (advancedActive ? `|adv:${JSON.stringify(advanced)}` : ''),
  );
  /** One chip per column filter that is either live or was just picked from
   *  the "+ Filter" menu (`openChips` — shown while still inert so its
   *  popover has something to edit). */
  const filterChipList = $derived.by(() =>
    filterChips
      ? columns.flatMap((c) => {
          if (!isFilterActive(filters[c.key]) && !openChips.includes(c.key)) return [];
          return [{ key: c.key, col: c, kind: filterKindOf(c) }];
        })
      : [],
  );
  const chipBarShown = $derived(filterChipList.length > 0 || advancedActive || !!chips);

  // Seed caller-requested defaults once; the effect below handles later key changes
  // without converting user-controlled expand/collapse state into a derived value.
  // svelte-ignore state_referenced_locally
  // Keyed on the joined ids, not the array identity: the caller rebuilds this
  // array on every derivation, so an identity check would re-seed constantly
  // and stomp the user's manual collapses.
  const initialExpandedKey = $derived((initialExpanded ?? []).join('\u0000'));
  $effect(() => {
    const key = initialExpandedKey;
    untrack(() => {
      if (key === '') return;
      expanded = new Set(key.split('\u0000'));
    });
  });
  function toggleExpand(id: string, e?: Event) {
    e?.stopPropagation();
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    expanded = next;
  }
  const subRowsOf = (row: T) => (getSubRows ? (getSubRows(row) ?? []) : []);
  function rowExpandable(row: T): boolean {
    if (!expandEnabled) return false;
    if (isExpandable) return isExpandable(row);
    return subRowsOf(row).length > 0 || !!expandedContent;
  }

  // ── Row virtualization ────────────────────────────────────────────────────
  // Flatten the FULL `view` (no window) into row items + expanded same-shape
  // descendants + expanded custom blocks, in DOM order. `itemIndex` is this
  // item's position in the flat list (what the virtualizer indexes by);
  // `rowIndex` is this row's position among row-kind items only (what roving
  // j/k focus indexes by — block rows aren't focusable).
  type FlatItem =
    | {
        kind: 'row';
        row: T;
        depth: number;
        id: string;
        key: string;
        itemIndex: number;
        rowIndex: number;
      }
    | { kind: 'expanded'; row: T; id: string; key: string; itemIndex: number }
    | {
        kind: 'group';
        group: RowGroup<T>;
        id: string;
        key: string;
        itemIndex: number;
      };
  // ── Group-by (synthetic header rows over the same expansion path) ──────────
  // A group header is NOT of type T, so it travels as its own FlatItem kind
  // rather than as a faked row — that is what keeps `flatRows` (selection,
  // roving focus, cell coordinates) free of rows that aren't records.
  const groups = $derived.by(() =>
    groupBy
      ? groupRows(view, groupBy).map((group) => ({ ...group, id: `__group:${group.key}` }))
      : [],
  );
  /** Groups open by default (a wall of collapsed headers is an extra click per
   *  screen); a manual collapse survives because each id is only ever auto-opened
   *  once. */
  const autoExpandedGroups = new Set<string>();
  $effect(() => {
    const ids = groups.map((g) => g.id);
    untrack(() => {
      if (!groupBy || groupBy.collapsed) return;
      const add = ids.filter((id) => !autoExpandedGroups.has(id));
      if (!add.length) return;
      for (const id of add) autoExpandedGroups.add(id);
      expanded = new Set([...expanded, ...add]);
    });
  });
  const flatItems = $derived.by(() => {
    const out: FlatItem[] = [];
    let rowIndex = 0;
    const walk = (row: T, depth: number) => {
      const id = getRowId(row);
      out.push({
        kind: 'row',
        row,
        depth,
        id,
        key: id,
        itemIndex: out.length,
        rowIndex: rowIndex++,
      });
      if (!expanded.has(id)) return;
      const kids = subRowsOf(row);
      if (kids.length) for (const k of kids) walk(k, depth + 1);
      else if (expandedContent)
        out.push({ kind: 'expanded', row, id, key: `${id}::expanded`, itemIndex: out.length });
    };
    if (groupBy) {
      for (const group of groups) {
        out.push({ kind: 'group', group, id: group.id, key: group.id, itemIndex: out.length });
        if (expanded.has(group.id)) for (const row of group.rows) walk(row, 0);
      }
      return out;
    }
    for (const row of view) walk(row, 0);
    return out;
  });
  const flatRows = $derived(
    flatItems.filter((fi): fi is FlatItem & { kind: 'row' } => fi.kind === 'row'),
  );

  // Scroll container for the virtualizer (also the roving-focus DOM anchor,
  // bound on the `overflow-auto` wrapper div in the template below).
  let wrapperEl: HTMLDivElement | null = $state(null);
  // Drives the sticky actions column's separator (left border) — only shown
  // once the table has actually been scrolled horizontally, so a table that
  // fits doesn't show a stray divider line.
  let scrolledX = $state(false);
  function onTableScroll() {
    maybeRequestNextPage();
    scrolledX = (wrapperEl?.scrollLeft ?? 0) > 0;
  }
  // Named `rowVirt` (not `v`) — a per-cell `{@const v = ...}` already shadows
  // `v` inside the cell-render scope further down.
  // The WHOLE construction runs inside `untrack` — not just the `count:`
  // read — because `createVirtualizer`'s wrapper (`$lib/virtual/virtualizer.svelte`)
  // seeds its `$state` cache by calling `instance.getVirtualItems()`
  // synchronously, which calls `getItemKey(i)` for every item RIGHT THERE.
  // Without `untrack`, those calls read `flatItems` inside this derived's
  // tracked scope, so it still depended on flatItems.length in practice (a
  // `count: untrack(...)` alone did not fix it — confirmed by a failing
  // regression test). Only `browser`/`wrapperEl` (read for the condition,
  // outside `untrack`) should retrigger this derivation. Every row
  // expand/collapse changes flatItems.length; re-deriving here would call
  // createVirtualizer() again, discarding the measured row heights AND
  // resetting scrollOffset to 0 (virtual-core only syncs scrollOffset from a
  // live "scroll" DOM event — a fresh instance has none), which visually
  // snapped the list back to the top on every expand (root-caused
  // 2026-09-16). The effect below keeps count current instead.
  const rowVirt = $derived(
    browser && wrapperEl && virtualizeOn
      ? untrack(() =>
          createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
            count: flatItems.length,
            getScrollElement: () => wrapperEl,
            estimateSize: () => rowH,
            // `?.` is load-bearing: the count-sync effect below runs in a LATER
            // pass than the render, so on any SHRINK of `flatItems` (a group
            // collapse, or switching a `groupBy` axis on, which replaces N row
            // items with one collapsed header) virtual-core still recomputes
            // measurements for indexes that no longer exist. The template
            // already guards that window with `{#if !fi}`; unguarded here it
            // threw an uncaught TypeError from inside the virtualizer and left
            // the table rendering a single group header (root-caused in the
            // browser on /pos/catalog, 2026-09-28).
            getItemKey: (i) => flatItems[i]?.key ?? i,
            overscan: 10,
          }),
        )
      : null,
  );
  // Keeps the already-created virtualizer's row count in sync without
  // recreating it (see note above) — setOptions() updates in place (and, per
  // the wrapper's own fix, immediately refreshes its cached virtual-items
  // list) instead of waiting for the next scroll/resize event. This can't be
  // a `$derived` (Svelte forbids mutating state — what setOptions does here —
  // inside one: `state_unsafe_mutation`), so it stays an effect, which runs
  // in a LATER pass than the template's own render effect. That leaves a
  // narrow window on a row COLLAPSE where the template can render against the
  // now-shorter `flatItems` while `vItems` still has an index for the removed
  // row — guarded below with `{#if fi}` rather than by trying to force effect
  // ordering.
  $effect(() => {
    const count = flatItems.length;
    rowVirt?.setOptions({ ...rowVirt.options, count });
  });
  const measureRow = (node: HTMLTableRowElement) => {
    rowVirt?.measureElement(node);
  };
  // A QUERY change (search/filter/sort) → snap back to the top, same intent
  // as the old renderLimit reset. Keyed on the query inputs, NOT on `view`:
  // `view` also changes identity whenever the rows prop is refreshed (every
  // cell-edit save re-fetches), and that must keep the scroll position.
  // Infinite mode: an APPEND (page > 1) must not yank the user back to the
  // top — only page-1 replacements snap.
  $effect(() => {
    void [search, filterSignature, sortSignature];
    untrack(() => {
      if (server?.infinite && serverPage > 1) return;
      rowVirt?.scrollToOffset(0);
    });
  });

  // ── Selection ──────────────────────────────────────────────────────────────
  function emitSelection(next: Set<string>) {
    selectedIds = next;
    onSelectionChange?.(
      next,
      data.filter((r) => next.has(getRowId(r))),
    );
  }
  // Range-select anchor: the last row touched by a plain click, ctrl-click, or
  // checkbox toggle (NOT by a shift-click, which extends from the existing anchor).
  let lastAnchor = $state<string | null>(null);
  function toggleRow(id: string, e?: Event) {
    e?.stopPropagation();
    lastAnchor = id;
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    emitSelection(next);
  }
  const viewIds = $derived(view.map(getRowId));
  const allSelected = $derived(viewIds.length > 0 && viewIds.every((id) => selectedIds.has(id)));
  const someSelected = $derived(!allSelected && viewIds.some((id) => selectedIds.has(id)));
  function toggleAll() {
    emitSelection(allSelected ? new Set() : new Set(viewIds));
  }
  let selectingAllMatching = $state(false);
  async function selectAllMatching() {
    if (!server?.onSelectAllMatching || selectingAllMatching) return;
    selectingAllMatching = true;
    try {
      emitSelection(new Set(await server.onSelectAllMatching()));
    } catch {
      // Caller owns the domain-specific error surface; preserve current selection.
    } finally {
      selectingAllMatching = false;
    }
  }
  function runBulk(a: BulkAction<T>) {
    a.onSelect(
      selectedIds,
      data.filter((r) => selectedIds.has(getRowId(r))),
    );
  }
  /** Danger action(s) last, per the floating bar's contract. */
  const sortedBulkActions = $derived(
    [...(bulkActions ?? [])].sort((a, b) => (a.danger ? 1 : 0) - (b.danger ? 1 : 0)),
  );

  // ── Row click: modifier-aware selection (OS file-manager idioms) ──────────
  // Ctrl/Cmd+click toggles the row (no nav). Shift+click extends a contiguous
  // range from lastAnchor over the CURRENT view order, unioned into the
  // existing selection. Plain click sets the anchor and falls through to
  // onRowClick. Applies even when onRowClick is undefined (checkbox-only
  // tables still get modifier-click selection).
  function handleRowClick(id: string, row: T, e: MouseEvent) {
    if (selectable && (e.ctrlKey || e.metaKey)) {
      toggleRow(id);
      return;
    }
    if (selectable && e.shiftKey) {
      e.preventDefault(); // avoid text-selection artifacts while shift-clicking
      const ids = viewIds;
      const from = ids.indexOf(lastAnchor ?? id);
      const to = ids.indexOf(id);
      if (from > -1 && to > -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const next = new Set(selectedIds);
        for (const rid of ids.slice(lo, hi + 1)) next.add(rid);
        emitSelection(next);
      }
      return;
    }
    lastAnchor = id;
    if (onRowClick) {
      onRowClick(row);
      return;
    }
    // Anchors (title link / open affordance) already handle their own click —
    // avoid double-opening the record when the click bubbles up from one.
    if (rowOpenOn && titleColumn && !(e.target as HTMLElement).closest('a')) {
      const href = titleColumn.href(row);
      if (href) void openRecord(href, resolvedOpenMode);
    }
  }

  // ── Roving row focus (WAI-ARIA grid pattern: j/k, arrows, Enter, Space) ────
  // (`wrapperEl` is declared above, next to the virtualizer that reads it.)
  let searchInputEl: HTMLInputElement | null = $state(null);
  let focusedIndex = $state(-1);
  function focusRow(i: number) {
    if (flatRows.length === 0) return;
    focusedIndex = Math.max(0, Math.min(i, flatRows.length - 1));
    // Bring the target into the virtualizer's rendered range first (it may not
    // be mounted yet), then settle with a DOM scrollIntoView once it measures.
    rowVirt?.scrollToIndex(flatRows[focusedIndex].itemIndex, { align: 'auto' });
    requestAnimationFrame(() => {
      wrapperEl
        ?.querySelector<HTMLElement>(`[data-row-index="${focusedIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }
  function moveFocus(delta: number) {
    if (focusedIndex < 0) focusRow(delta >= 0 ? 0 : flatRows.length - 1);
    else focusRow(focusedIndex + delta);
  }

  // Table-wrapper hotkeys — element-scoped (never global), so a page-level
  // Mod+A/Escape/etc. outside the table keeps native behavior. Bare keys
  // (j/k, /, Delete, Backspace, arrows, Enter, Space) stay input-safe by the
  // library's default (protects inline-edit inputs); Mod+A gets an explicit
  // `ignoreInputs` override so it doesn't hijack native text select-all while
  // inline-editing a cell.
  const gridAttachment = createHotkeysAttachment(() => {
    const danger = bulkOn ? bulkActions?.find((a) => a.danger) : undefined;
    return [
      {
        hotkey: 'Mod+A',
        callback: () => emitSelection(new Set(viewIds)),
        options: { enabled: selectable, ignoreInputs: true },
      },
      {
        hotkey: 'Escape',
        callback: () => emitSelection(new Set()),
        options: { enabled: selectable && selectedIds.size > 0, stopPropagation: false },
      },
      {
        hotkey: 'Delete',
        callback: () => {
          if (danger && selectedIds.size > 0) runBulk(danger);
        },
      },
      {
        hotkey: 'Backspace',
        callback: () => {
          if (danger && selectedIds.size > 0) runBulk(danger);
        },
      },
      {
        hotkey: '/',
        callback: () => searchInputEl?.focus(),
        options: { enabled: searchOn },
      },
      // `enabled: !sel` on every roving-focus binding below is load-bearing,
      // not just belt-and-suspenders alongside each callback's own `!sel`
      // check: this library's hotkeys default to `stopPropagation: true` and
      // apply it BEFORE invoking the callback (`registration.options.enabled`
      // is the only thing that skips that step) — so with `sel` active but no
      // `enabled` gate, these document-scoped bindings swallowed
      // ArrowUp/ArrowDown/Enter/Space before `onGridKeydown`'s own cell-nav
      // cases (`moveSel`/`startEdit`) ever saw them, even though the callback
      // itself correctly no-opped. Cell selection must fully own these keys.
      { hotkey: 'ArrowDown', callback: () => moveFocus(1), options: { enabled: !sel } },
      { hotkey: 'J', callback: () => moveFocus(1), options: { enabled: !sel } },
      { hotkey: 'ArrowUp', callback: () => moveFocus(-1), options: { enabled: !sel } },
      { hotkey: 'K', callback: () => moveFocus(-1), options: { enabled: !sel } },
      {
        hotkey: 'Enter',
        callback: () => {
          const fr = flatRows[focusedIndex];
          if (fr) onRowClick?.(fr.row);
        },
        options: { enabled: !sel },
      },
      {
        hotkey: 'Space',
        callback: () => {
          if (!selectable) return;
          const fr = flatRows[focusedIndex];
          if (fr) toggleRow(fr.id);
        },
        options: { enabled: !sel },
      },
    ];
  });

  // ── Cell editing (Notion-style select/edit + Excel fill handle) ────────────
  // Coordinates are (flatRows index, visibleColumns index) — the VISUAL grid,
  // so sorting/filtering/reordering never desync what the user sees from
  // what a key or drag acts on. Every cell is addressable/selectable (owner
  // directive 2026-09-29); only editable/customEditable columns can open an
  // editor — `editing` opens the built-in input, `customOpen` signals a
  // `cells`/`cell` snippet to open ITS own editor (e.g. InlineTagsCell's tag
  // popover) via the `open`/`onOpenChange` DataCellContext fields.
  type Pos = { r: number; c: number };
  let sel = $state<{ a: Pos; b: Pos } | null>(null);
  let editing = $state<Pos | null>(null);
  let customOpen = $state<Pos | null>(null);
  let editVal = $state('');
  /** rowId → draft overlay shown while a save is in flight (visual feedback = trust). */
  let pending = $state(new Map<string, EditDraft>());
  /** `${rowId}|${key}` of cells whose last save failed. */
  let failed = $state(new Set<string>());
  let fillTo = $state<number | null>(null);
  let pendingCells = $state(new Set<string>());
  let blockedRows = $state(new Set<string>());
  let conflictRows = $state(new Set<string>());
  const actionRuntime = tryUseActions();
  // svelte-ignore state_referenced_locally
  const saves = rowSaveController ?? createRowSaveController();
  const unsubscribeSaves = saves.subscribe(() => {
    const view = saves.view();
    pending = view.values;
    pendingCells = view.pending;
    failed = view.failed;
    blockedRows = view.blocked;
    conflictRows = view.conflicts;
  });
  $effect(() => {
    const scopeVersion = actionRuntime?.scopeVersion;
    if (scopeVersion !== undefined)
      untrack(() => {
        saves.reset(scopeVersion);
        editing = null;
        editVal = '';
        sel = null;
        fillTo = null;
      });
  });
  const cellKey = saves.key;
  onDestroy(() => {
    unsubscribeSaves();
    if (!rowSaveController) saves.dispose();
  });
  $effect(() => {
    const source = flatRows.map((fr) => ({ id: fr.id, draft: canonicalDraft(fr) }));
    untrack(() => {
      for (const row of source) saves.reconcile(row.id, row.draft);
    });
  });
  const selBox = $derived(
    sel
      ? {
          r0: Math.min(sel.a.r, sel.b.r),
          r1: Math.max(sel.a.r, sel.b.r),
          c0: Math.min(sel.a.c, sel.b.c),
          c1: Math.max(sel.a.c, sel.b.c),
        }
      : null,
  );
  const fillBox = $derived(
    selBox && fillTo != null
      ? { r0: Math.min(selBox.r0, fillTo), r1: Math.max(selBox.r1, fillTo) }
      : null,
  );
  const inSel = (r: number, c: number) =>
    !!selBox && r >= selBox.r0 && r <= selBox.r1 && c >= selBox.c0 && c <= selBox.c1;
  const inFill = (r: number, c: number) =>
    !!fillBox && !!selBox && r >= fillBox.r0 && r <= fillBox.r1 && c >= selBox.c0 && c <= selBox.c1;
  const isCorner = (r: number, c: number) => !!selBox && r === selBox.r1 && c === selBox.c1;
  // Drop stale coordinates when the grid they index changes shape.
  $effect(() => {
    const rows = flatRows.length,
      cols = visibleColumns.length;
    untrack(() => {
      if (sel && (sel.a.r >= rows || sel.b.r >= rows || sel.a.c >= cols || sel.b.c >= cols))
        sel = null;
      if (editing && (editing.r >= rows || editing.c >= cols)) editing = null;
    });
  });

  /** Current value as the draft string (pending overlay wins over the row). */
  function cellStr(fr: { row: T; id: string }, c: DataColumn<T>): string {
    const ov = pending.get(fr.id)?.[c.key];
    if (ov !== undefined) return ov;
    const v = acc(c)(fr.row);
    if (v == null) return '';
    if (colType(c) === 'date') {
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
      if (typeof v === 'string') return v.slice(0, 10);
    }
    return String(v);
  }
  /** Row with the pending overlay folded in, so custom cells never snap back. */
  function rowView(fr: { row: T; id: string }): T {
    const ov = pending.get(fr.id);
    if (!ov || typeof fr.row !== 'object' || fr.row === null) return fr.row;
    const patch: Record<string, unknown> = {};
    for (const c of editableCols) {
      const v = ov[c.key];
      if (v === undefined) continue;
      const t = colType(c);
      patch[c.key] =
        t === 'number' ? (v === '' ? null : Number(v)) : t === 'boolean' ? v === 'true' : v;
    }
    return { ...(fr.row as object), ...patch } as T;
  }
  function canonicalDraft(fr: { row: T; id: string }): EditDraft {
    const d: EditDraft = {};
    for (const c of editableCols) {
      const value = acc(c)(fr.row);
      d[c.key] =
        value == null
          ? ''
          : colType(c) === 'date'
            ? value instanceof Date
              ? value.toISOString().slice(0, 10)
              : String(value).slice(0, 10)
            : String(value);
    }
    return d;
  }
  async function saveCells(batch: { r: number; changes: EditDraft }[]) {
    const persist = onSaveRow;
    if (!persist) return;
    const jobs = batch
      .map(({ r, changes }) => ({ fr: flatRows[r], changes }))
      .filter(({ fr, changes }) => fr && Object.keys(changes).length > 0);
    if (!jobs.length) return;
    const retainUnsent = jobs.map(({ fr, changes }) =>
      saves.prepareAdmissionFailure(fr.id, changes),
    );
    const execute = async (context?: CommandContext): Promise<CommandOutcome<RowOutcome[]>> => {
      const results = await Promise.all(
        jobs.map(({ fr, changes }) =>
          saves.save(
            fr.id,
            fr.row,
            canonicalDraft(fr),
            changes,
            persist,
            context ? { ...context, acknowledge: () => {} } : undefined,
          ),
        ),
      );
      return completeRowSaves(results, onSaveComplete, context);
    };
    await runDraftCommand(actionRuntime, 'table.save', execute, () => {
      for (const retain of retainUnsent) retain();
    });
  }

  function selectCell(r: number, c: number, extend = false) {
    // Moving to a different cell closes any open custom-cell editor (tag
    // popover, etc.) — only the currently selected cell may hold one open.
    if (customOpen && (customOpen.r !== r || customOpen.c !== c)) customOpen = null;
    sel = extend && sel ? { a: sel.a, b: { r, c } } : { a: { r, c }, b: { r, c } };
    focusedIndex = r;
    wrapperEl?.focus({ preventScroll: true });
    rowVirt?.scrollToIndex(flatRows[r]?.itemIndex ?? r, { align: 'auto' });
  }
  function moveSel(dr: number, dc: number, extend = false) {
    if (!sel) return;
    const from = sel.b;
    const r = Math.max(0, Math.min(flatRows.length - 1, from.r + dr));
    // Every cell is selectable now — arrow/Tab moves land on read-only
    // columns too instead of skipping them.
    const c = Math.max(0, Math.min(visibleColumns.length - 1, from.c + dc));
    selectCell(r, c, extend);
  }
  function startEdit(pos: Pos, seed?: string) {
    const c = visibleColumns[pos.c],
      fr = flatRows[pos.r];
    if (!c || !fr || blockedRows.has(fr.id)) return;
    if (colEditable(c)) {
      if (colType(c) === 'boolean') {
        const current = cellStr(fr, c);
        const next = failed.has(cellKey(fr.id, c.key))
          ? current
          : current === 'true'
            ? 'false'
            : 'true';
        void saveCells([{ r: pos.r, changes: { [c.key]: next } }]);
        return;
      }
      editVal = seed ?? cellStr(fr, c);
      editing = pos;
      if (colType(c) === 'select') {
        // The Select adapter does not forward attachments to its native
        // control, so focus + open it once the editor has flushed — still
        // inside the click's activation window, which `showPicker()` needs
        // (owner 2026-09-30: UOM took three clicks — select, mount, open).
        void tick().then(() => {
          const el = wrapperEl?.querySelector<HTMLSelectElement>('td.dt-editing select');
          if (!el) return;
          el.focus();
          try {
            el.showPicker?.();
          } catch {
            /* no activation / unsupported: the focused select opens on Space */
          }
        });
      }
      return;
    }
    if (customCellCanEdit(c)) customOpen = pos;
  }
  function commitEdit(move?: [number, number]) {
    const pos = editing;
    if (!pos) return;
    editing = null;
    const c = visibleColumns[pos.c],
      fr = flatRows[pos.r];
    if (c && fr && (editVal !== cellStr(fr, c) || failed.has(cellKey(fr.id, c.key))))
      void saveCells([{ r: pos.r, changes: { [c.key]: editVal } }]);
    wrapperEl?.focus({ preventScroll: true });
    if (move) moveSel(move[0], move[1]);
  }
  function cancelEdit() {
    editing = null;
    wrapperEl?.focus({ preventScroll: true });
  }
  function onCellPointerDown(r: number, c: number, e: PointerEvent) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return; // modifier-clicks keep row semantics
    if (editing && editing.r === r && editing.c === c) return;
    if (editing) commitEdit();
    // Cancel the default mousedown focus move: it would land on the wrapper
    // AFTER the editor mounts and blur-commit it on the same click.
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
      selectCell(r, c, true);
      return;
    }
    const again = !!sel && sel.a.r === r && sel.a.c === c && sel.b.r === r && sel.b.c === c;
    selectCell(r, c);
    if (again) startEdit({ r, c }); // Notion: clicking the selected cell opens it
  }
  function onGridKeydown(e: KeyboardEvent) {
    if (!sel || editing || e.target !== wrapperEl) return; // inner inputs own their keys
    const ext = e.shiftKey;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return moveSel(1, 0, ext);
      case 'ArrowUp':
        e.preventDefault();
        return moveSel(-1, 0, ext);
      case 'ArrowRight':
        e.preventDefault();
        return moveSel(0, 1, ext);
      case 'ArrowLeft':
        e.preventDefault();
        return moveSel(0, -1, ext);
      case 'Tab':
        e.preventDefault();
        return moveSel(0, ext ? -1 : 1);
      case 'Enter':
      case 'F2':
        e.preventDefault();
        return startEdit(sel.b);
      case ' ':
        if (colType(visibleColumns[sel.b.c]) === 'boolean') {
          e.preventDefault();
          startEdit(sel.b);
        }
        return;
      case 'Escape':
        sel = null;
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const col = visibleColumns[sel.b.c];
      const t = colType(col);
      // Typing-to-replace only applies to the built-in text/number editor —
      // a read-only or custom (e.g. tag) cell ignores keystrokes.
      if (colEditable(col) && (t === 'text' || t === 'number')) {
        e.preventDefault();
        startEdit(sel.b, e.key); // spreadsheet: typing replaces the value
      }
    }
  }
  function onEditorKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit([e.shiftKey ? -1 : 1, 0]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit([0, e.shiftKey ? -1 : 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
    e.stopPropagation();
  }
  const autofocus = (root: HTMLElement) => {
    // A component attachment lands on the component's root (the Select
    // adapter's wrapper), so reach the real control inside it.
    const el =
      root instanceof HTMLInputElement || root instanceof HTMLSelectElement
        ? root
        : (root.querySelector<HTMLElement>('select, input') ?? root);
    el.focus();
    if (el instanceof HTMLInputElement && el.type === 'text') el.select();
  };

  // Fill handle: drag the selection's corner up/down; the selected block is
  // repeated into every row the drag covers (Excel copy-fill; no series
  // extrapolation). Row hit-testing uses elementFromPoint so it works through
  // the virtualizer — a target row must be rendered, which a drag inside the
  // scroll pane guarantees.
  function startFill(e: PointerEvent) {
    if (!selBox) return;
    e.preventDefault();
    e.stopPropagation();
    fillTo = selBox.r1;
  }
  function onFillMove(e: PointerEvent) {
    if (fillTo == null) return;
    const tr = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-row-index]');
    if (tr) fillTo = Number(tr.dataset.rowIndex);
  }
  function onFillEnd() {
    if (fillTo == null || !selBox || !fillBox) return;
    const box = selBox,
      to = fillBox;
    fillTo = null;
    const n = box.r1 - box.r0 + 1;
    const cols = visibleColumns.slice(box.c0, box.c1 + 1).filter(colEditable);
    const batch: { r: number; changes: EditDraft }[] = [];
    for (let r = to.r0; r <= to.r1; r++) {
      if (r >= box.r0 && r <= box.r1) continue;
      const src = flatRows[box.r0 + ((((r - box.r0) % n) + n) % n)];
      const dst = flatRows[r];
      if (!src || !dst) continue;
      const changes: EditDraft = {};
      for (const c of cols) {
        const v = cellStr(src, c);
        if (v !== cellStr(dst, c)) changes[c.key] = v;
      }
      batch.push({ r, changes });
    }
    sel = { a: { r: to.r0, c: box.c0 }, b: { r: to.r1, c: box.c1 } };
    void saveCells(batch);
  }
  const fillable = $derived(
    !!selBox && !editing && visibleColumns.slice(selBox.c0, selBox.c1 + 1).every(colEditable),
  );

  function fmtDate(v: unknown): string {
    const d = v instanceof Date ? v : typeof v === 'string' && v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : '—';
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  let exportOpen = $state(false);
  const exportColumns = $derived(columns.filter((c) => c.exportable !== false));
  const exportDialogCols = $derived(
    exportColumns.map((c) => ({
      key: c.key,
      label: colLabel(c),
      default: c.exportDefault ?? !hidden.has(c.key),
    })),
  );
  function handleExport(format: 'csv' | 'xlsx', keys: string[]) {
    if (server?.onExport) {
      server.onExport(format, keys);
      return;
    }
    const cols = exportColumns.filter((c) => keys.includes(c.key));
    const val = (c: DataColumn<T>, row: T): string | number => {
      if (c.exportValue) return c.exportValue(row);
      const v = acc(c)(row);
      return v == null ? '' : typeof v === 'number' ? v : String(v);
    };
    const rows: Rows = [
      cols.map((c) => colLabel(c)),
      ...view.map((row) => cols.map((c) => val(c, row))),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${exportName}-${stamp}.${format}`;
    if (format === 'csv') downloadCsv(name, rows);
    else downloadXlsx(name, rows);
  }

  const colSpan = $derived(visibleColumns.length + (selectable ? 1 : 0) + (expandEnabled ? 1 : 0));
  /** Same gate the trailing add-column cell and (formerly) the toolbar
   *  "+ Add column" button used: custom properties are wired up AND the
   *  viewer can manage them. */
  const addColShown = $derived(customEnabled && !!customBundle?.canManage);
  /** Every rendered column, including the trailing spacer, actions and
   *  add-column cells. */
  const spanAll = $derived(colSpan + 1 + (rowActions ? 1 : 0) + (addColShown ? 1 : 0));
  function cellAlign(a?: string) {
    return a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
  }
  /** Header/cell inline style: the reorder drag transform plus a frozen `left`. */
  function colStyle(c: DataColumn<T>, i: number): string | undefined {
    const parts = [
      hdrDrag?.active && hdrDrag.key === c.key ? `transform:translateX(${hdrDrag.dx}px)` : '',
      i < stickyLefts.length ? `left:${stickyLefts[i]}px` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(';') : undefined;
  }
  const showColMenu = $derived(
    columnMenuOn && columns.some((c) => c.hideable !== false || reorderOn),
  );
  const bulkShown = $derived(bulkOn && !!bulkActions?.length);
  const addShown = $derived(addOn && (!!addMenu?.length || !!onAdd));
  const footerShown = $derived(footer && visibleColumns.some((c) => aggList(c).length > 0));
  const rootStyle = $derived(
    [`--dt-row-h:${rowH}px`, fixedHeight ? `height:${fixedHeight}` : '', styleProp ?? '']
      .filter(Boolean)
      .join(';'),
  );
  const rootClass = $derived(
    [
      'dt-root flex flex-col min-h-0',
      fixedHeight ? '' : heightMode === 'fit' ? 'dt-plain' : 'h-full',
      density === 'compact' ? 'dt-compact' : density === 'comfortable' ? 'dt-comfortable' : '',
      hasStickyCells ? 'dt-has-sticky' : '',
      rowActionsMode === 'always' ? 'dt-actions-always' : '',
      className,
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

{#snippet aggIcon(mode: AggMode)}
  {#if mode === 'sum'}<Sigma size={10} />{:else if mode === 'avg'}<Divide size={10} />{:else}<Hash
      size={10}
    />{/if}
{/snippet}

<svelte:document
  onpointermove={fillTo != null ? onFillMove : undefined}
  onpointerup={fillTo != null ? onFillEnd : undefined}
  onpointerdown={onDocPointerDown}
  onkeydown={onDocKeydown}
  oncontextmenu={onDocContextMenu}
/>

<div class={rootClass} style={rootStyle} {...rest}>
  {#if failed.size > 0}
    <div class="flex items-center gap-2 p-2 t-caption" role="status">
      <span
        >{conflictRows.size
          ? m.asyncAction_conflict()
          : blockedRows.size
            ? m.asyncAction_unknown()
            : m.asyncAction_failed()}</span
      >
      {#if blockedRows.size}
        <Button variant="secondary" size="sm" onclick={() => window.location.reload()}
          >{m.asyncAction_reload()}</Button
        >
      {/if}
    </div>
  {/if}
  {#if customProjectionFailed}
    <div class="flex items-center gap-2 p-2 t-caption" role="status">
      <span>{m.custom_columns_saved_refresh_failed()}</span>
      <Button variant="secondary" size="sm" onclick={() => void refreshCustomProjection()}>
        {m.asyncAction_retry()}
      </Button>
    </div>
  {/if}
  <!-- Toolbar (compact, SAP-style: inline search + icon actions with tooltips) -->
  {#if searchOn || exportOn || addShown || showColMenu || toolbar || actions || bulkShown || customEnabled || canSwitchOpenMode || filterBarOn}
    <div class="dt-toolbar">
      {#if searchOn}
        <div class="dt-search">
          <Search size={13} class="dt-search-ico" />
          <input
            bind:this={searchInputEl}
            bind:value={search}
            oninput={() => server && emitSearchQuery()}
            placeholder={searchPlaceholder ?? m.data_table_search()}
          />
        </div>
      {/if}
      {#if selectedIds.size > 0}
        <span class="dt-count text-accent">{m.data_table_selected({ n: selectedIds.size })}</span>
        {#if server?.onSelectAllMatching && allSelected && selectedIds.size < server.total}
          <Button
            variant="ghost"
            size="xs"
            class="dt-tool"
            disabled={selectingAllMatching}
            onclick={selectAllMatching}
          >
            {m.data_table_select_all_matching({ n: server.total })}
          </Button>
        {/if}
      {:else if server}
        <!-- server-mode range/total renders as the pager label below -->
      {:else}
        <span class="dt-count tabular-nums">
          {#if filterActive}{m.data_table_showing({
              shown: view.length,
              total: data.length,
            })}{:else}{m.data_table_rows({ total: data.length })}{/if}
        </span>
      {/if}
      {#if server}
        {#if server.infinite}
          <span class="dt-count tabular-nums">
            {data.length} / {server.total}
          </span>
        {:else}
          <div class="flex items-center gap-1">
            <Button
              variant="secondary"
              size="icon"
              type="button"
              class="!h-6 !w-6"
              disabled={!serverCanPrev}
              aria-label={m.a11y_previous_page()}
              onclick={() => goToServerPage(serverPage - 1)}
            >
              <ChevronLeft size={iconSizes.xs} />
            </Button>
            <span class="dt-count tabular-nums">
              {serverRangeStart}–{serverRangeEnd} / {server.total}
            </span>
            <Button
              variant="secondary"
              size="icon"
              type="button"
              class="!h-6 !w-6"
              disabled={!serverCanNext}
              aria-label={m.a11y_next_page()}
              onclick={() => goToServerPage(serverPage + 1)}
            >
              <ChevronRight size={iconSizes.xs} />
            </Button>
          </div>
        {/if}
      {/if}

      {@render toolbar?.()}

      <div class="ml-auto flex items-center gap-1">
        {@render actions?.()}
        {#if exportOn}
          <!-- Export takes an ACTION (produces a file) rather than changing how
               the table is viewed, so it sits outside the view-tools segment
               (owner directive 2026-09-29). -->
          <Tooltip label={m.data_table_export()} asChild>
            {#snippet children(p)}
              <Button
                variant="ghost"
                size="xs"
                shape="icon"
                {...p}
                class="dt-tool"
                aria-label={m.data_table_export()}
                onclick={() => (exportOpen = true)}
              >
                <Download size={iconSizes.sm} />
              </Button>
            {/snippet}
          </Tooltip>
        {/if}
        {#if filterBarOn || (groupOptions && groupOptions.length > 0) || showColMenu || canSwitchOpenMode || (customEnabled && customBundle?.canManage) || options}
          <!-- View-tools segment (owner directive 2026-09-29): Filter, Group by,
               Columns and Table options all change how the table DISPLAYS rows
               (never an action), so they're grouped in one bordered pill. -->
          <div class="dt-view-tools">
            {#if filterBarOn}
              <FilterAddMenu
                columns={filterColumnsMeta}
                onPick={pickFilter}
                onAdvanced={server ? undefined : openAdvanced}
                active={anyColumnFilter}
              />
            {/if}
            {#if groupOptions && groupOptions.length > 0}
              <!-- GroupByPicker keeps its OWN self-contained trigger recipe
                   (`.gbp-btn`, already `--control-height-xs`/`--radius-sm` —
                   same box as `.dt-tool`); that file's styles belong to a
                   concurrent slice, so no `.dt-tool` class is forwarded here. -->
              <GroupByPicker
                options={groupOptions}
                value={groupValue}
                noneLabel={groupNoneLabel}
                onChange={(v) => {
                  groupValue = v;
                  onGroupChange?.(v);
                }}
              />
            {/if}
            {#if showColMenu}
              <div class="col-wrap" bind:this={colMenuRoot}>
                <Tooltip label={m.data_table_columns()} asChild>
                  {#snippet children(p)}
                    <Button
                      variant="ghost"
                      size="xs"
                      shape="icon"
                      {...p}
                      class={`dt-tool${hidden.size > 0 ? ' active-col' : ''}`}
                      aria-label={m.data_table_columns()}
                      aria-expanded={colMenuOpen}
                      onclick={() => (colMenuOpen = !colMenuOpen)}
                    >
                      <Columns3 size={iconSizes.sm} />
                    </Button>
                  {/snippet}
                </Tooltip>
                {#if colMenuOpen}
                  <div class="col-menu">
                    <div class="col-menu-h">{m.data_table_columns_heading()}</div>
                    {#each orderedColumns as c (c.key)}
                      {@const canHide = c.hideable !== false}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div
                        class="col-item"
                        class:dragging={menuDragKey === c.key}
                        draggable={reorderOn}
                        ondragstart={reorderOn ? () => (menuDragKey = c.key) : undefined}
                        ondragover={reorderOn ? (e) => e.preventDefault() : undefined}
                        ondrop={reorderOn ? () => onMenuDrop(c.key) : undefined}
                      >
                        {#if reorderOn}<GripVertical size={12} class="col-grip" />{/if}
                        <Button
                          variant="ghost"
                          size="xs"
                          class="col-check-btn"
                          disabled={!canHide}
                          aria-label={colLabel(c)}
                          onclick={() => canHide && toggleHidden(c.key)}
                        >
                          <span class="col-check" class:on={!hidden.has(c.key)}>
                            {#if !hidden.has(c.key)}<Check size={11} />{/if}
                          </span>
                          <span class="col-label">{colLabel(c)}</span>
                        </Button>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
            {#if canSwitchOpenMode || (customEnabled && customBundle?.canManage) || options}
              <!-- Table options (spec 2026-09-29 table-toolbar): the ⚙ no longer
                   jumps straight into the custom-property manager — it opens a
                   menu of table-level settings, one of which links to that
                   manager. Trigger content is a plain span, not a Button: it
                   renders INSIDE the Popover's own trigger element, and nesting
                   a real button tag there would be invalid HTML (see Dropdown's
                   add-menu for the same idiom). -->
              <Popover placement="bottom-end">
                {#snippet trigger()}
                  <Tooltip label={m.data_table_options()}>
                    {#snippet children()}
                      <span class="dt-tool" aria-label={m.data_table_options()}>
                        <Settings2 size={iconSizes.sm} />
                      </span>
                    {/snippet}
                  </Tooltip>
                {/snippet}
                {#snippet children()}
                  <div class="dt-options-menu">
                    <div class="dt-options-head">
                      <div class="col-menu-h">{m.data_table_options()}</div>
                      {#if canSwitchOpenModeOrg}
                        <!-- Kebab: every change above is FOR THE VIEWER ONLY;
                             this is the one explicit org-wide action, gated on
                             the same `settings:manage` capability that grants
                             admin/manager/owner roles write access to
                             /settings/tables. -->
                        <Dropdown
                          items={[{ value: 'apply-org', label: m.data_table_options_apply_org() }]}
                          onSelect={() => void applyOpenModeOrg()}
                        >
                          {#snippet trigger()}
                            <span
                              class="dt-tool dt-opt-kebab"
                              aria-label={m.data_table_options_apply_org()}
                            >
                              <MoreHorizontal size={iconSizes.sm} />
                            </span>
                          {/snippet}
                        </Dropdown>
                      {/if}
                    </div>
                    {#if options}
                      <div class="col-menu-h">{m.data_table_options_view()}</div>
                      <div class="dt-opt-block">{@render options()}</div>
                      {#if canSwitchOpenMode || (customEnabled && customBundle?.canManage)}<div
                          class="col-menu-div"
                        ></div>{/if}
                    {/if}
                    {#if canSwitchOpenMode}
                      <div class="col-menu-h">{m.record_peek_open_in()}</div>
                      <SegmentedControl
                        class="col-open-in"
                        aria-label={m.record_peek_open_in()}
                        value={resolvedOpenMode}
                        items={OPEN_MODES.map((v) => ({ value: v, label: OPEN_MODE_LABEL[v]() }))}
                        onValueChange={(v) => setOpenMode(v)}
                      />
                    {/if}
                    {#if customEnabled && customBundle?.canManage}
                      {#if canSwitchOpenMode}<div class="col-menu-div"></div>{/if}
                      <div class="col-menu-h">{m.data_table_options_properties()}</div>
                      <Button
                        variant="ghost"
                        size="xs"
                        class="dt-opt-row"
                        onclick={() => void openCustomManager()}
                      >
                        <Settings2 size={iconSizes.xs} />
                        {m.custom_columns_manage_title()}
                      </Button>
                    {/if}
                  </div>
                {/snippet}
              </Popover>
            {/if}
          </div>
        {/if}
        {#if addShown && addMenu?.length}
          <!-- Menu form of the add affordance: the + opens a Dropdown of typed
               create actions (e.g. stock movement kinds) instead of one onAdd. -->
          <Dropdown items={addMenu} onSelect={(v) => onAddSelect?.(v)}>
            {#snippet trigger()}
              <span class="dt-tool dt-tool-primary" title={addLabel ?? m.data_table_add()}>
                <Plus size={iconSizes.md} aria-hidden="true" />
                <span class="sr-only">{addLabel ?? m.data_table_add()}</span>
              </span>
            {/snippet}
          </Dropdown>
        {:else if addShown && onAdd}
          <Tooltip label={addLabel ?? m.data_table_add()} asChild>
            {#snippet children(p)}
              <Button
                variant="primary"
                size="xs"
                shape="icon"
                {...p}
                aria-label={addLabel ?? m.data_table_add()}
                disabled={addDisabled}
                onclick={onAdd}
              >
                <Plus size={iconSizes.sm} />
              </Button>
            {/snippet}
          </Tooltip>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Active-filter chips: one removable chip per live (or just-picked)
       column filter, one advanced-rules chip when `advanced` has rules, plus
       any chip the caller appends, plus Clear all. Hidden entirely when
       nothing is filtered, so an unfiltered table looks exactly as it did
       before. -->
  {#if chipBarShown}
    <div class="dt-chips">
      {#each filterChipList as chip (chip.key)}
        <FilterChip
          label={colLabel(chip.col)}
          kind={chip.kind}
          options={chip.kind === 'enum' ? enumOptionsOf(chip.col) : []}
          value={filters[chip.key] ?? emptyFilter(chip.kind)}
          onValue={(v) => setFilterValue(chip.key, v)}
          onRemove={() => removeChip(chip.key)}
          optionIcon={chip.col.filter?.icon ? filterOptionIcon : undefined}
          open={chipOpenState[chip.key] ?? false}
        />
      {/each}
      {#if advanced && advancedActive}
        {@const advGroup = advanced}
        <div class="dt-adv-chip">
          <Popover bind:open={advancedOpen} placement="bottom">
            {#snippet trigger()}
              <span class="dt-adv-trigger">
                <ListFilter size={iconSizes.xs} />
                <span
                  >{advGroup.items.length === 1
                    ? m.data_table_filter_rule_one()
                    : m.data_table_filter_rules({ n: advGroup.items.length })}</span
                >
              </span>
            {/snippet}
            <AdvancedFilterBuilder
              group={advGroup}
              columns={filterColumnsMeta}
              onChange={(next) => {
                advanced = next;
                requery();
              }}
              onDelete={() => {
                advanced = null;
                advancedOpen = false;
                requery();
              }}
            />
          </Popover>
        </div>
      {/if}
      {@render chips?.()}
      {#if filterChipList.length > 0 || advancedActive}
        <Button variant="ghost" size="xs" class="dt-chip-clear" onclick={clearFilters}>
          {m.data_table_filters_clear_all()}
        </Button>
      {/if}
    </div>
  {/if}

  <!-- Table -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex-1 min-h-0 dt-scroll {heightMode === 'fit' ? 'overflow-x-auto' : 'overflow-auto'}"
    class:scrolled-x={scrolledX}
    tabindex="0"
    bind:this={wrapperEl}
    onscroll={onTableScroll}
    onkeydown={onGridKeydown}
    {@attach gridAttachment}
  >
    {#if hasError}
      <div
        class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center"
        role="alert"
      >
        {#if errorContent}
          {@render errorContent(error)}
        {:else}
          <p class="t-caption">
            {error instanceof Error && error.message ? error.message : m.data_table_error()}
          </p>
          {#if onRetry}
            <Button variant="secondary" size="sm" onclick={onRetry}>{m.asyncAction_retry()}</Button>
          {/if}
        {/if}
      </div>
    {:else if loading && data.length === 0}
      <!-- Skeleton rows, not a spinner: the shape of the answer is already known,
           and a row-height placeholder keeps the pane from collapsing. -->
      <div class="dt-skeleton" role="status" aria-busy="true" aria-label={m.data_table_loading()}>
        {#each Array.from({ length: Math.max(1, loadingRows) }) as _, i (i)}
          <div class="dt-skeleton-row"><Skeleton height="var(--dt-row-h)" /></div>
        {/each}
      </div>
    {:else if data.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        {#if empty}
          {@render empty()}
        {:else}
          <p class="t-caption">{emptyMessage ?? m.data_table_empty()}</p>
        {/if}
      </div>
    {:else}
      <table
        bind:this={tableEl}
        class="dt-table text-sm"
        class:dragging={hdrDrag?.active}
        style="width:100%; min-width:{totalWidth}px"
      >
        <colgroup>
          {#if selectable}<col style="width:{SEL_W}px" />{/if}
          {#if expandEnabled}<col style="width:{EXP_W}px" />{/if}
          {#each visibleColumns as c, i (c.key)}
            {#if c.fill}<col />{:else}<col style="width:{dataWidth(c, i)}px" />{/if}
          {/each}
          <!-- spacer: absorbs leftover width when the table is narrower than the pane;
					     collapses to 0 (min-width forces horizontal scroll) when it overflows.
					     A `fill` column takes that role instead. Rendered BEFORE the actions
					     column so actions is always the table's true last column — a spacer
					     after it would steal the visual "flush right" spot from the sticky cell. -->
          {#if !hasFill}<col />{/if}
          {#if rowActions}<col style="width:{ACT_W}px" />{/if}
          {#if addColShown}<col style="width:{ADD_COL_W}px" />{/if}
        </colgroup>
        <thead
          class="sticky top-0 bg-bg/95 backdrop-blur z-[var(--layer-sticky)]"
          bind:this={theadEl}
        >
          <tr class="text-left t-caption border-b border-[var(--hairline)]">
            {#if selectable}
              <th class="dt-th px-3 py-2">
                <Button
                  variant="ghost"
                  size="xs"
                  class={`dt-check is-master${allSelected ? ' on' : ''}${someSelected ? ' ind' : ''}`}
                  role="checkbox"
                  aria-checked={someSelected ? 'mixed' : allSelected}
                  aria-label={m.data_table_select_all()}
                  onclick={toggleAll}
                >
                  {#if someSelected}<Minus size={11} />{:else if allSelected}<Check
                      size={11}
                    />{/if}
                </Button>
              </th>
            {/if}
            {#if expandEnabled}<th class="dt-th"></th>{/if}
            {#each visibleColumns as c, i (c.key)}
              {@const sortEntry = sortOf(c.key)}
              {@const sorted = !!sortEntry}
              {@const sortRank = sort.length > 1 ? sort.indexOf(sortEntry!) + 1 : 0}
              {@const aggs = aggList(c)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <th
                data-col={c.key}
                class="dt-th px-3 py-2 font-medium {cellAlign(c.align)} {c.headerClass ?? ''}"
                class:dragging={hdrDrag?.active && hdrDrag.key === c.key}
                class:drop-before={dropTarget?.key === c.key && dropTarget.side === 'before'}
                class:drop-after={dropTarget?.key === c.key && dropTarget.side === 'after'}
                class:dt-frozen={i < stickyLefts.length}
                class:dt-frozen-last={i === stickyLefts.length - 1}
                style={colStyle(c, i)}
                onpointerdown={(e) => onHeaderPointerDown(c, e)}
                oncontextmenu={(e) => openCtx(c, e)}
              >
                {#if reorderOn}<GripVertical size={11} class="grip" />{/if}
                <!-- Aggregates stack ABOVE the title; the title stays pinned to the
								     cell bottom (dt-th vertical-align:bottom) so every column's title
								     lines up regardless of how many aggregates it shows. -->
                {#if aggs.length}
                  <div class="dt-agg-row">
                    {#each aggs as a (a.mode)}
                      <span class="dt-agg" title={a.mode}>{a.value}{@render aggIcon(a.mode)}</span>
                    {/each}
                  </div>
                {/if}
                <div
                  class="flex items-center gap-1 {c.align === 'right'
                    ? 'justify-end'
                    : c.align === 'center'
                      ? 'justify-center'
                      : ''}"
                >
                  {#if c.filter}
                    <ColumnFilter
                      label={colLabel(c)}
                      kind={filterKindOf(c)}
                      options={c.filter.options?.() ?? []}
                      selected={filterSet(c.key)}
                      value={filters[c.key] ?? null}
                      align={c.filter.align ?? (c.align === 'right' ? 'right' : 'left')}
                      optionIcon={c.filter.icon ? filterOptionIcon : undefined}
                      onSelect={(s) => setFilter(c.key, s)}
                      onValue={(v) => setFilterValue(c.key, v)}
                    />
                  {:else if headers?.[c.key]}
                    {@render headers[c.key](c)}
                  {:else if c.customHeader && headerCell}
                    {@render headerCell(c)}
                  {:else if c.sortable !== false}
                    <Button
                      variant="ghost"
                      size="xs"
                      class={`sort-h${sorted ? ' active' : ''}`}
                      onclick={(e: MouseEvent) => toggleSort(c, e.shiftKey)}
                    >
                      <span class="dt-hlabel">{colLabel(c)}</span>
                      {#if sortEntry}
                        {#if sortEntry.dir === 'asc'}<ArrowUp size={12} />{:else}<ArrowDown
                            size={12}
                          />{/if}
                        {#if sortRank}<span class="dt-sort-rank">{sortRank}</span>{/if}
                      {:else}<ChevronsUpDown size={11} class="dim" />{/if}
                    </Button>
                  {:else}
                    <span class="dt-hlabel">{colLabel(c)}</span>
                  {/if}
                </div>
                {#if resizable && c.resizable !== false}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span
                    class="dt-resize"
                    class:resizing={resizeKey === c.key}
                    onpointerdown={(e) => onResizeDown(c, i, e)}
                    ondblclick={(e) => autoFitColumn(c, e)}
                    title={m.data_table_fit_column()}
                  ></span>
                {/if}
              </th>
            {/each}
            {#if !hasFill}<th class="dt-th" aria-hidden="true"></th>{/if}
            {#if rowActions}
              <th class="dt-th dt-act"><span class="sr-only">{m.data_table_row_actions()}</span></th
              >
            {/if}
            {#if addColShown}
              <th class="dt-th dt-add-col">
                <Tooltip label={m.custom_columns_add()} asChild>
                  {#snippet children(p)}
                    <Button
                      {...p}
                      variant="ghost"
                      size="xs"
                      aria-label={m.custom_columns_add()}
                      onclick={() => void openCustomManager(null, true)}
                    >
                      <Plus size={iconSizes.xs} />
                      {m.custom_columns_add()}
                    </Button>
                  {/snippet}
                </Tooltip>
              </th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#if view.length === 0}
            <tr
              ><td colspan={spanAll} class="px-4 py-8 text-center t-caption text-muted-foreground"
                >{m.data_table_no_match()}</td
              ></tr
            >
          {:else if rowVirt || !virtualizeOn}
            {@const vItems = rowVirt
              ? rowVirt.getVirtualItems()
              : flatItems.map((fi, index) => ({ index, key: fi.key, start: 0, end: 0 }))}
            <!-- Spacer rows (not absolutely-positioned <tr>s — that breaks table
						     layout/sticky-thead) absorb the space above/below the rendered
						     window so the scrollbar reflects the FULL flattened list. -->
            <tr style="height:{vItems[0]?.start ?? 0}px" aria-hidden="true"></tr>
            {#each vItems as vi (vi.key)}
              {@const fi = flatItems[vi.index]}
              <!-- `vItems` (the virtualizer's cached range) and `flatItems`
			         (recomputed fresh on every expand/collapse) can be one render
			         pass out of sync — the count-sync effect above settles it a
			         moment later. Skip a row `vItems` still references but
			         `flatItems` has already dropped, instead of crashing. -->
              {#if !fi}
                <!-- settles on the next render once the count-sync effect runs -->
              {:else if fi.kind === 'expanded'}
                <tr class="dt-block-row" data-index={vi.index} {@attach measureRow}>
                  <td colspan={spanAll} class="dt-block">{@render expandedContent?.(fi.row)}</td>
                </tr>
              {:else if fi.kind === 'group'}
                {@const isOpen = expanded.has(fi.id)}
                <tr class="dt-group-row" data-index={vi.index} {@attach measureRow}>
                  <td colspan={spanAll} class="dt-group-cell" data-group={fi.group.key}>
                    <Button
                      variant="ghost"
                      size="xs"
                      class={`dt-exp${isOpen ? ' open' : ''}`}
                      aria-label={isOpen ? m.data_table_collapse() : m.data_table_expand()}
                      aria-expanded={isOpen}
                      onclick={(e: Event) => toggleExpand(fi.id, e)}
                    >
                      <ChevronRight size={iconSizes.sm} />
                    </Button>
                    {#if groupRow}
                      {@render groupRow(fi.group.key, fi.group.rows)}
                    {:else}
                      <span class="dt-group-label">{fi.group.label}</span>
                      <span class="dt-group-count"
                        >{m.data_table_rows({ total: fi.group.rows.length })}</span
                      >
                    {/if}
                  </td>
                </tr>
              {:else}
                {@const row = rowView(fi)}
                {@const id = fi.id}
                {@const canExpand = rowExpandable(row)}
                {@const isOpen = expanded.has(id)}
                <tr
                  data-row-index={fi.rowIndex}
                  data-index={vi.index}
                  {@attach measureRow}
                  class="dt-row border-b border-[var(--hairline)] hover:bg-bg3 transition-colors {onRowClick ||
                  rowOpenOn
                    ? 'cursor-pointer'
                    : ''} {rowClass?.(row) ?? ''}"
                  style={rowStyle?.(row)}
                  class:child={fi.depth > 0}
                  class:focused={focusedIndex === fi.rowIndex}
                  onclick={selectable || onRowClick || rowOpenOn
                    ? (e) => handleRowClick(id, row, e)
                    : undefined}
                >
                  {#if selectable}
                    <td class="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="xs"
                        class={`dt-check is-row${selectedIds.has(id) ? ' on' : ''}`}
                        role="checkbox"
                        aria-checked={selectedIds.has(id)}
                        aria-label="select row"
                        onclick={(e) => toggleRow(id, e)}
                      >
                        {#if selectedIds.has(id)}<Check size={11} />{/if}
                      </Button>
                    </td>
                  {/if}
                  {#if expandEnabled}
                    <td class="dt-tree-cell px-1 py-2 text-center" style="--tree-depth:{fi.depth}">
                      {#if canExpand}
                        <Button
                          variant="ghost"
                          size="xs"
                          class={`dt-exp${isOpen ? ' open' : ''}`}
                          aria-label={isOpen ? m.data_table_collapse() : m.data_table_expand()}
                          onclick={(e) => toggleExpand(id, e)}
                        >
                          <ChevronRight size={13} />
                        </Button>
                      {/if}
                    </td>
                  {/if}
                  {#each visibleColumns as c, ci (c.key)}
                    {@const editableHere = colEditable(c)}
                    {@const customHere = customCellCanEdit(c)}
                    {@const actionable = editableHere || customHere}
                    {@const r = fi.rowIndex}
                    {@const isEditing = !!editing && editing.r === r && editing.c === ci}
                    {@const isCustomOpen =
                      !!customOpen && customOpen.r === r && customOpen.c === ci}
                    {@const t = colType(c)}
                    <td
                      data-col={c.key}
                      data-editable={actionable}
                      class="dt-cell px-3 py-2 {cellAlign(c.align)} {c.cellClass ?? ''}"
                      class:dt-wrap={wrap.has(c.key)}
                      class:dt-editable={actionable}
                      class:dt-sel={anyCellEditable && inSel(r, ci)}
                      class:dt-sel-focus={anyCellEditable &&
                        !!sel &&
                        sel.b.r === r &&
                        sel.b.c === ci}
                      class:dt-fillprev={anyCellEditable && inFill(r, ci) && !inSel(r, ci)}
                      class:dt-pending={pendingCells.has(cellKey(id, c.key))}
                      class:dt-failed={failed.has(cellKey(id, c.key))}
                      class:dt-editing={isEditing}
                      class:dt-frozen={ci < stickyLefts.length}
                      class:dt-frozen-last={ci === stickyLefts.length - 1}
                      style={colStyle(c, ci)}
                      onpointerdown={anyCellEditable
                        ? (e) => onCellPointerDown(r, ci, e)
                        : undefined}
                      onclick={anyCellEditable ? (e) => e.stopPropagation() : undefined}
                      ondblclick={editableHere && !isEditing
                        ? () => startEdit({ r, c: ci })
                        : undefined}
                    >
                      {#if isEditing && t === 'select'}
                        <Select
                          size="xs"
                          selectClass="dt-inp"
                          value={editVal}
                          options={c.options?.() ?? []}
                          onchange={(v) => {
                            editVal = String(v);
                            commitEdit();
                          }}
                          onkeydown={onEditorKeydown}
                        />
                      {:else if isEditing}
                        <input
                          class="dt-inp w-full {c.align === 'right' ? 'text-right' : ''}"
                          type={t === 'number' ? 'number' : t === 'date' ? 'date' : 'text'}
                          step={t === 'number' ? 'any' : undefined}
                          bind:value={editVal}
                          onkeydown={onEditorKeydown}
                          onblur={() => commitEdit()}
                          {@attach autofocus}
                        />
                      {:else if isTitle(c) && titleColumn && titleColumn.href(row)}
                        {@const href = titleColumn.href(row)}
                        <span class="dt-title">
                          {#if !c.custom && !cells?.[c.key] && !actionable}
                            <a {href} class="dt-title-link" onclick={titleAnchorClick(href)}
                              >{@render cellBody(c, row, fi, t, isCustomOpen)}</a
                            >
                          {:else}
                            {@render cellBody(c, row, fi, t, isCustomOpen)}
                          {/if}
                          <a
                            {href}
                            class="dt-open"
                            aria-label={m.data_table_open()}
                            onpointerdown={(e) => e.stopPropagation()}
                            onclick={titleAnchorClick(href)}><ArrowUpRight /></a
                          >
                        </span>
                      {:else}
                        {@render cellBody(c, row, fi, t, isCustomOpen)}
                      {/if}
                      {#if fillable && isCorner(r, ci)}
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <span class="dt-fill" title={m.data_table_fill()} onpointerdown={startFill}
                        ></span>
                      {/if}
                    </td>
                  {/each}
                  {#if !hasFill}<td aria-hidden="true"></td>{/if}
                  {#if rowActions}
                    <!-- Sticky trailing actions cell. The wrapper swallows click
                         and pointerdown so a row action never doubles as a row
                         click (opening a drawer behind the dialog it just opened
                         is the failure every caller hand-guarded against). -->
                    <td class="dt-cell dt-act">
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <div
                        class="dt-row-actions"
                        onclick={(e) => e.stopPropagation()}
                        onpointerdown={(e) => e.stopPropagation()}
                      >
                        {@render rowActions(row)}
                      </div>
                    </td>
                  {/if}
                  {#if addColShown}<td class="dt-cell dt-add-col" aria-hidden="true"></td>{/if}
                </tr>
              {/if}
            {/each}
            {#if rowVirt}
              <tr
                style="height:{rowVirt.getTotalSize() - (vItems[vItems.length - 1]?.end ?? 0)}px"
                aria-hidden="true"
              ></tr>
            {/if}
          {/if}
        </tbody>
        {#if footerShown}
          <!-- One footer row from the SAME per-column aggregate state the header
               shows, so a column that reads "sum" above also totals below. -->
          <tfoot class="dt-tfoot">
            <tr>
              {#if selectable}<td class="dt-foot-cell"></td>{/if}
              {#if expandEnabled}<td class="dt-foot-cell"></td>{/if}
              {#each visibleColumns as c, i (c.key)}
                {@const aggs = aggList(c)}
                <td
                  data-foot-col={c.key}
                  class="dt-foot-cell px-3 py-2 {cellAlign(c.align)}"
                  class:dt-frozen={i < stickyLefts.length}
                  class:dt-frozen-last={i === stickyLefts.length - 1}
                  style={colStyle(c, i)}
                >
                  {#each aggs as a (a.mode)}
                    {#if footerCell}
                      {@render footerCell(c, a.mode, a.raw)}
                    {:else}
                      <span class="dt-foot-val" title={a.mode}
                        >{a.value}{@render aggIcon(a.mode)}</span
                      >
                    {/if}
                  {/each}
                </td>
              {/each}
              {#if !hasFill}<td class="dt-foot-cell" aria-hidden="true"></td>{/if}
              {#if rowActions}<td class="dt-foot-cell dt-act" aria-hidden="true"></td>{/if}
              {#if addColShown}<td class="dt-foot-cell dt-add-col" aria-hidden="true"></td>{/if}
            </tr>
          </tfoot>
        {/if}
      </table>
    {/if}

    <!-- Floating bulk bar (Notion-style): replaces the old toolbar kebab. A
         zero-height sticky anchor pins the pill to the bottom of THIS scroll
         pane (not the viewport) so it survives the table's own overflow
         container without a fixed backdrop. -->
    {#if showBulkBar}
      <div class="dt-bulk-anchor">
        <div class="dt-bulk-bar" role="toolbar" aria-label={m.data_table_bulk_actions()}>
          <span class="dt-bulk-count">{m.data_table_selected({ n: selectedIds.size })}</span>
          {#if bulkEditAllCols.length}
            <span class="dt-bulk-div" aria-hidden="true"></span>
            <Popover placement="top">
              {#snippet trigger()}
                <span class="dt-bulk-trig"
                  >{m.data_table_bulk_edit()}<ChevronDown
                    size={iconSizes.xs}
                    aria-hidden="true"
                  /></span
                >
              {/snippet}
              {#snippet children()}
                <div class="dt-bulk-edit-panel">
                  <Select
                    size="xs"
                    value={resolvedBulkEditKey ?? ''}
                    options={bulkEditAllCols.map((c) => ({ value: c.key, label: colLabel(c) }))}
                    onchange={(v) => {
                      bulkEditKey = String(v);
                      resetBulkEditDraft();
                    }}
                  />
                  {#if bulkEditColumn}
                    {#if bulkEditCustomDef}
                      {@const rules = bulkEditCustomDef.rules}
                      {#if rules.type === 'boolean'}
                        <Toggle
                          checked={bulkEditValue === 'true'}
                          label={m.data_table_bulk_edit_value()}
                          onchange={(v) => (bulkEditValue = String(v))}
                        />
                      {:else if rules.type === 'select'}
                        <Select
                          size="xs"
                          value={bulkEditOptions[0] ?? ''}
                          options={rules.options
                            .filter((o) => !o.archivedAt)
                            .map((o) => ({ value: o.id, label: o.label }))}
                          onchange={(v) => (bulkEditOptions = [String(v)])}
                        />
                      {:else if rules.type === 'multi_select'}
                        <div class="dt-bulk-checklist" role="listbox" aria-multiselectable="true">
                          {#each rules.options.filter((o) => !o.archivedAt) as option (option.id)}
                            {@const optSelected = bulkEditOptions.includes(option.id)}
                            <Button
                              variant="ghost"
                              size="xs"
                              class="dt-bulk-check-opt"
                              role="option"
                              aria-selected={optSelected}
                              onclick={() =>
                                (bulkEditOptions = optSelected
                                  ? bulkEditOptions.filter((v) => v !== option.id)
                                  : [...bulkEditOptions, option.id])}
                            >
                              <TagChip size="sm" name={option.label} color={option.color} />
                              {#if optSelected}<Check size={iconSizes.xs} />{/if}
                            </Button>
                          {/each}
                        </div>
                      {:else if rules.type === 'date'}
                        <input type="date" class="dt-inp" bind:value={bulkEditValue} />
                      {:else}
                        <Input
                          size="sm"
                          type={rules.type === 'number' ? 'number' : 'text'}
                          bind:value={bulkEditValue}
                        />
                      {/if}
                    {:else}
                      {@const bt = colType(bulkEditColumn)}
                      {#if bt === 'boolean'}
                        <Toggle
                          checked={bulkEditValue === 'true'}
                          label={m.data_table_bulk_edit_value()}
                          onchange={(v) => (bulkEditValue = String(v))}
                        />
                      {:else if bt === 'select'}
                        <Select
                          size="xs"
                          value={bulkEditValue}
                          options={bulkEditColumn.options?.() ?? []}
                          onchange={(v) => (bulkEditValue = String(v))}
                        />
                      {:else if bt === 'date'}
                        <input type="date" class="dt-inp" bind:value={bulkEditValue} />
                      {:else}
                        <Input
                          size="sm"
                          type={bt === 'number' ? 'number' : 'text'}
                          bind:value={bulkEditValue}
                        />
                      {/if}
                    {/if}
                  {/if}
                  <Button
                    variant="primary"
                    size="xs"
                    disabled={!bulkEditColumn || bulkEditApplying}
                    onclick={applyBulkEdit}
                  >
                    {m.data_table_bulk_edit_apply()}
                  </Button>
                </div>
              {/snippet}
            </Popover>
          {/if}
          {#if showBulkTags}
            <span class="dt-bulk-div" aria-hidden="true"></span>
            <Popover placement="top">
              {#snippet trigger()}
                <span class="dt-bulk-trig"
                  >{m.data_table_bulk_tags()}<ChevronDown
                    size={iconSizes.xs}
                    aria-hidden="true"
                  /></span
                >
              {/snippet}
              {#snippet children()}
                <div class="dt-bulk-edit-panel">
                  <TagOptionList
                    scope={tagScope!}
                    tags={bulkTagRegistry}
                    selected={bulkTagSelected}
                    ontoggle={toggleBulkTag}
                    onreconcile={loadBulkTagRegistry}
                    oncreate={(t) => (bulkTagRegistry = [...bulkTagRegistry, t])}
                    onupdate={(t) =>
                      (bulkTagRegistry = bulkTagRegistry.map((x) => (x.id === t.id ? t : x)))}
                    ondelete={(id) =>
                      (bulkTagRegistry = bulkTagRegistry.filter((x) => x.id !== id))}
                  />
                  <Button
                    variant="primary"
                    size="xs"
                    disabled={(!bulkTagAdd.size && !bulkTagRemove.size) || bulkTagsApplying}
                    onclick={applyBulkTags}
                  >
                    {m.data_table_bulk_tags_apply()}
                  </Button>
                </div>
              {/snippet}
            </Popover>
          {/if}
          {#if sortedBulkActions.length}
            <span class="dt-bulk-div" aria-hidden="true"></span>
            {#each sortedBulkActions as a (a.label)}
              <Button
                variant="ghost"
                size="xs"
                class={`dt-bulk-item${a.danger ? ' danger' : ''}`}
                onclick={() => runBulk(a)}
              >
                {a.label}
              </Button>
            {/each}
          {/if}
          <span class="dt-bulk-div" aria-hidden="true"></span>
          <Button
            variant="ghost"
            size="xs"
            class="dt-bulk-clear"
            aria-label={m.data_table_bulk_clear()}
            onclick={() => emitSelection(new Set())}
          >
            <X size={iconSizes.sm} />
          </Button>
        </div>
      </div>
    {/if}
  </div>
</div>

{#snippet cellBody(
  c: DataColumn<T>,
  row: T,
  fi: { row: T; id: string },
  t: CellType,
  customCellOpen: boolean,
)}
  {@const definition = customDefinition(c.key)}
  {@const customRecordId = definition ? customProperties?.recordId(row) : null}
  {#if definition && customRecordId && customBundle && valueActions}
    {@const customUnavailable = !isCustomPropertyRecordAvailable(customBundle, customRecordId)}
    {@const propertyCell = customBundle.values[customRecordId]?.[definition.id] ?? {
      propertyId: definition.id,
      recordId: customRecordId,
      present: false,
      value: null,
      effectiveValue: definition.hasDefault ? definition.defaultValue : null,
      version: 0,
      updatedAt: null,
    }}
    {@const secondaryId =
      definition.presentation?.version === 1
        ? (definition.presentation.secondary?.propertyId ?? null)
        : null}
    {@const secondaryDefinition = secondaryId
      ? (customBundle.definitions.find((entry) => entry.id === secondaryId) ?? null)
      : null}
    {@const secondaryCell = secondaryId
      ? (customBundle.values[customRecordId]?.[secondaryId] ?? null)
      : null}
    <CustomPropertyCell
      {definition}
      cell={propertyCell}
      recordId={customRecordId}
      unavailable={customUnavailable}
      {secondaryDefinition}
      {secondaryCell}
      secondaryUnavailable={!!secondaryId && (!secondaryDefinition || !secondaryCell)}
      canEdit={customCellCanEdit(c) &&
        customBundle.canEdit &&
        (customBundle.recordAccess[customRecordId]?.canEdit ?? false)}
      actions={valueActions}
      onconfirmed={(confirmed) => confirmCustomCell(customRecordId, confirmed)}
    />
  {:else if definition}
    <span title={m.custom_columns_unavailable()}>—</span>
  {:else if cells?.[c.key]}
    {@render cells[c.key](row, c, {
      canEdit: customCellCanEdit(c),
      open: customCellOpen,
      onOpenChange: (v) => {
        if (!v) customOpen = null;
      },
    })}
  {:else if c.custom && cell}
    {@render cell(row, c, {
      canEdit: customCellCanEdit(c),
      open: customCellOpen,
      onOpenChange: (v) => {
        if (!v) customOpen = null;
      },
    })}
  {:else if t === 'boolean'}
    {@const on = cellStr(fi, c) === 'true'}
    <span class="dt-bool" class:on aria-label={String(on)}
      >{#if on}<Check size={11} />{/if}</span
    >
  {:else if t === 'date'}
    {fmtDate(acc(c)(row))}
  {:else if t === 'select'}
    {@const v = cellStr(fi, c)}
    {v === '' ? '—' : (c.options?.().find((o) => o.value === v)?.label ?? v)}
  {:else}
    {@const v = acc(c)(row)}
    {v == null || v === '' ? '—' : v}
  {/if}
{/snippet}

<!-- Header context menu: Sort/Wrap at top level; Filter▸ and Aggregate▸ are
     nested flyouts (owner: "aggregation as well as filtering ... could be
     added to a nested menu instead of showing them straight in the context
     menu"). Dismissal is the shared document-level pointerdown/Escape/
     contextmenu listener below — no fixed backdrop (see the col-wrap note). -->
{#if ctxMenu}
  {@const cc = byKey.get(ctxMenu.key)}
  <div class="ctx-menu" bind:this={ctxMenuRoot} style="left:{ctxMenu.x}px; top:{ctxMenu.y}px">
    {#if cc}
      {@const fKind = filterKindOf(cc)}
      {#if cc.sortable !== false}
        <Button
          variant="ghost"
          size="xs"
          class="ctx-item"
          onclick={() => {
            setSort(cc, 'asc');
            closeCtx();
          }}><ArrowUp size={13} /> {m.data_table_sort_asc()}</Button
        >
        <Button
          variant="ghost"
          size="xs"
          class="ctx-item"
          onclick={() => {
            setSort(cc, 'desc');
            closeCtx();
          }}><ArrowDown size={13} /> {m.data_table_sort_desc()}</Button
        >
        <div class="ctx-sep"></div>
      {/if}
      <Button
        variant="ghost"
        size="xs"
        class="ctx-item"
        onclick={() => {
          toggleWrap(cc.key);
          closeCtx();
        }}
      >
        <WrapText size={13} />
        {m.data_table_wrap_text()}
        {#if wrap.has(cc.key)}<Check size={12} class="ctx-check" />{/if}
      </Button>
      <div class="ctx-sep"></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ctx-parent" onmouseenter={() => (ctxSub = 'filter')}>
        <Button
          variant="ghost"
          size="xs"
          class="ctx-item"
          aria-haspopup="menu"
          aria-expanded={ctxSub === 'filter'}
          onclick={() => (ctxSub = ctxSub === 'filter' ? null : 'filter')}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'ArrowRight') ctxSub = 'filter';
            else if (e.key === 'ArrowLeft') ctxSub = null;
          }}
        >
          <ListFilter size={13} />
          {m.data_table_ctx_filter()}
          <ChevronRight size={12} class="ctx-chevron" />
        </Button>
        {#if ctxSub === 'filter'}
          <div class="ctx-sub-menu" class:flip={ctxMenu.flip}>
            <Button
              variant="ghost"
              size="xs"
              class="ctx-item"
              onclick={() => {
                pickFilter(cc.key);
                closeCtx();
              }}
            >
              {m.data_table_ctx_filter_open()}
            </Button>
            <div class="ctx-sep"></div>
            {#each opsFor(fKind) as op (op)}
              <Button
                variant="ghost"
                size="xs"
                class="ctx-item"
                onclick={() => {
                  pickFilterOp(cc.key, fKind, op);
                  closeCtx();
                }}
              >
                {opLabel(fKind, op)}
              </Button>
            {/each}
          </div>
        {/if}
      </div>
      {#if numericKeys.has(cc.key)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="ctx-parent" onmouseenter={() => (ctxSub = 'aggregate')}>
          <Button
            variant="ghost"
            size="xs"
            class="ctx-item"
            aria-haspopup="menu"
            aria-expanded={ctxSub === 'aggregate'}
            onclick={() => (ctxSub = ctxSub === 'aggregate' ? null : 'aggregate')}
            onkeydown={(e: KeyboardEvent) => {
              if (e.key === 'ArrowRight') ctxSub = 'aggregate';
              else if (e.key === 'ArrowLeft') ctxSub = null;
            }}
          >
            <Sigma size={13} />
            {m.data_table_ctx_aggregate()}
            <ChevronRight size={12} class="ctx-chevron" />
          </Button>
          {#if ctxSub === 'aggregate'}
            <div class="ctx-sub-menu" class:flip={ctxMenu.flip}>
              <!-- non-exclusive: toggle each; menu stays open so several can be enabled -->
              {#each [['sum', m.data_table_agg_sum()], ['avg', m.data_table_agg_avg()], ['count', m.data_table_agg_count()]] as [mode, label] (mode)}
                <Button
                  variant="ghost"
                  size="xs"
                  class="ctx-item"
                  onclick={() => toggleAggregate(cc.key, mode as AggMode)}
                >
                  {@render aggIcon(mode as AggMode)}
                  {label}
                  {#if aggregates[cc.key]?.includes(mode as AggMode)}<Check
                      size={12}
                      class="ctx-check"
                    />{/if}
                </Button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      {#if customDefinition(cc.key) && customBundle?.canManage}
        <div class="ctx-sep"></div>
        <Button
          variant="ghost"
          size="xs"
          class="ctx-item"
          onclick={() => {
            void openCustomManager(customDefinition(cc.key)?.id ?? null);
            closeCtx();
          }}
        >
          <Settings2 size={iconSizes.xs} />
          {m.custom_columns_configure()}
        </Button>
      {/if}
    {/if}
  </div>
{/if}

{#if customEnabled && tableId && customBundle}
  {#key customScopeKey}
    <CustomPropertyManager
      bind:open={customManagerOpen}
      scopeKey={customScopeKey}
      tableId={tableId as CustomPropertyTableId}
      definitions={customManagerDefinitions}
      canManage={customBundle.canManage}
      loadFailed={customDefinitionsLoadFailed}
      selectedId={customManagerSelectedId}
      createOnOpen={customManagerCreate}
      actions={managerActions}
      onchanged={changeCustomDefinition}
      onloaded={(definitions) => {
        customManagerDefinitions = definitions;
        if (customBundle)
          customBundle = {
            ...customBundle,
            definitions: definitions.filter((entry) => !entry.archivedAt),
          };
      }}
      isScopeCurrent={(scope) => customScopeKey === scope}
      onreload={() => void openCustomManager(customManagerSelectedId, customManagerCreate)}
      previewRecords={customPreviewRecords}
    />
  {/key}
{/if}

{#if exportOn}
  <ExportDialog
    bind:open={exportOpen}
    columns={exportDialogCols}
    count={server?.total ?? view.length}
    formats={server?.exportFormats}
    onexport={handleExport}
  />
{/if}

<style>
  /* ── Compact toolbar ─────────────────────────────────────────────────── */
  .dt-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--hairline);
    min-height: var(--dt-head-h);
  }
  .dt-count {
    font-size: var(--font-size-label);
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }
  .dt-search {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: 9rem;
  }
  :global(.dt-search .dt-search-ico) {
    position: absolute;
    left: 0.35rem;
    color: var(--color-muted-foreground);
    pointer-events: none;
  }
  .dt-search input {
    height: 1.65rem;
    width: 100%;
    padding: 0 var(--space-2) 0 var(--space-6);
    font-size: var(--font-size-body);
    color: var(--color-foreground);
    background: transparent;
    border: 1px solid transparent;
    border-bottom-color: var(--hairline);
    border-radius: var(--radius-sm);
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard);
  }
  .dt-search input::placeholder {
    color: var(--color-muted-foreground);
    opacity: 0.7;
  }
  .dt-search input:hover {
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
  }
  .dt-search input:focus {
    outline: none;
    background: var(--color-bg3);
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
  }
  /* ── Toolbar icon-button contract (owner directive 2026-09-29: "squares vs
     squircles" — every toolbar icon trigger now shares ONE box) ─────────────
     Real `<Button variant="ghost" size="xs" shape="icon">` triggers (Export,
     Columns) get their SIZE/shape from the primitive itself
     (`aspect-square` + `h-[var(--control-height-xs)]` + `rounded-[var(--radius-sm)]`
     — see packages/ui Button.svelte); `.dt-tool` only adds the toolbar's own
     muted/hover/active colour so they read as one family with the popover
     trigger SPANS below (⚙, group-by, +) that can't be real Buttons (a
     button can't nest inside Popover/Dropdown's own trigger button — see
     the add-menu idiom) and so size themselves off the same
     `--control-height-xs` token by hand.
     NOTE: classes like dt-tool/dt-check/sort-h are forwarded as PROPS to the
     shared Button primitive, so plain scoped selectors never match them (the
     scope hash isn't applied across the component boundary). Every rule below
     anchors on a scoped ancestor element + :global() — see the
     "scoped-ancestor" layout contract in the UI governance skill. */
  .dt-toolbar :global(.dt-tool) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-xs);
    height: var(--control-height-xs);
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-muted-foreground);
    background: transparent;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard);
  }
  .dt-toolbar :global(.dt-tool:hover) {
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
    color: var(--color-foreground);
  }
  .dt-toolbar :global(.dt-tool.active-col),
  .dt-toolbar :global(.dt-tool.active) {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  /* The + add-MENU form (a Dropdown trigger span, can't be a real Button) —
     same accent-filled box the solo `+` Button (variant="primary" shape="icon")
     gets from the primitive. */
  .dt-toolbar :global(.dt-tool.dt-tool-primary) {
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .dt-toolbar :global(.dt-tool.dt-tool-primary:hover) {
    filter: brightness(1.08);
    background: var(--color-accent);
  }
  .dt-toolbar :global(.dt-tool:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  /* ── Grouped view-tools segment: Filter / Group by / Columns / Table
       options share ONE bordered pill (owner: "these items ... modify the
       way the table shows and displays items"), matching the SegmentedControl
       frame's own surface/border so the two read as one family. ─────────── */
  .dt-view-tools {
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .col-menu-div {
    height: 1px;
    margin: var(--space-1) var(--space-2);
    background: var(--color-border, var(--hairline));
  }
  /* ── Table options popover (⚙): kebab (org apply) + "Open in" + Properties ─ */
  /* Breathing room (owner 2026-09-30: "text too close to the edges"): the
     menu owns an inner gutter; headings and rows inset by the same step. */
  .dt-options-menu {
    display: flex;
    flex-direction: column;
    min-width: 15rem;
    max-width: 19rem;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-1) var(--space-2);
  }
  .dt-options-menu :global(.dt-opt-block) {
    padding: var(--space-1) var(--space-2) var(--space-2);
  }
  .dt-options-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .dt-options-head :global(.col-menu-h) {
    padding: 0;
  }
  .dt-options-menu :global(.col-open-in) {
    margin: 0 var(--space-2) var(--space-1);
  }
  .dt-options-menu :global(.dt-opt-row) {
    display: flex;
    width: 100%;
    height: auto;
    justify-content: flex-start;
    padding: var(--space-2) var(--space-2);
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-body);
    font-weight: 400;
    color: var(--color-foreground);
    text-align: left;
  }
  .dt-options-menu :global(.dt-opt-row > span) {
    width: 100%;
    justify-content: flex-start;
    gap: var(--space-2);
  }
  .dt-options-menu :global(.dt-opt-row:hover) {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  /* ── Trailing add-column cell: NOT sticky, scrolls with the last data
       column, always the table's true last column (after dt-act). ────────── */
  th.dt-add-col {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Floating bulk bar (Notion-style; replaces the old toolbar kebab) ───── */
  .dt-bulk-anchor {
    position: sticky;
    bottom: var(--space-4);
    left: 0;
    width: 100%;
    height: 0;
    overflow: visible;
    z-index: var(--layer-sticky);
    pointer-events: none;
  }
  .dt-bulk-bar {
    pointer-events: auto;
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-overlay);
    box-shadow: var(--shadow-overlay);
    white-space: nowrap;
    animation: panel-fade-in var(--duration-fast) var(--ease-standard);
  }
  .dt-bulk-count {
    padding: 0 var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .dt-bulk-div {
    width: 1px;
    align-self: stretch;
    margin: var(--space-1) 0;
    background: var(--color-border, var(--hairline));
  }
  .dt-bulk-trig {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    height: var(--control-height-sm);
    font-size: var(--font-size-caption);
    font-weight: 500;
    color: var(--color-text-primary);
    border-radius: var(--radius-sm);
  }
  .dt-bulk-bar :global(.dt-bulk-item) {
    color: var(--color-text-primary);
  }
  .dt-bulk-bar :global(.dt-bulk-item.danger) {
    color: var(--color-danger-fg);
  }
  .dt-bulk-edit-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    min-width: 12rem;
  }
  .dt-bulk-checklist {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 12rem;
    overflow-y: auto;
  }
  :global(.dt-bulk-check-opt) {
    justify-content: flex-start;
  }

  /* ── Table + fixed layout (resize one col → others hold; scroll x) ─────── */
  .dt-table {
    --dt-shadow-before: inset 2px 0 0 0 var(--color-accent);
    --dt-shadow-after: inset -2px 0 0 0 var(--color-accent);
    table-layout: fixed;
    border-collapse: collapse;
  }
  /* vertical-align:bottom pins every header's title to the cell bottom, so
	   titles line up across columns no matter how many aggregates stack above. */
  .dt-th {
    position: relative;
    user-select: none;
    vertical-align: bottom;
  }
  .dt-table.dragging .dt-th {
    cursor: grabbing;
  }
  .dt-th.dragging {
    z-index: var(--layer-dropdown);
    background: var(--color-card);
    box-shadow: var(--shadow-elevation-3);
    opacity: 0.97;
    cursor: grabbing;
  }
  .dt-th.drop-before {
    box-shadow: var(--dt-shadow-before);
  }
  .dt-th.drop-after {
    box-shadow: var(--dt-shadow-after);
  }
  .dt-hlabel {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Aggregates always stack vertically, above the title, right-aligned so the
	   value column lines up and the trailing icon sits under the sort/filter arrow. */
  .dt-agg-row {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-0-5);
    margin-bottom: var(--space-1);
  }
  /* Desaturated vs the pure accent a sorted header uses, so aggregate figures
	   read as secondary and don't get confused with the active-sort colour.
	   Override --dt-agg-color to retune. */
  .dt-agg {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    color: var(
      --dt-agg-color,
      color-mix(in srgb, var(--color-accent) 45%, var(--color-muted-foreground))
    );
    font-variant-numeric: tabular-nums;
  }
  .dt-table :global(.sort-h) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    height: auto;
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .dt-table :global(.sort-h:hover) {
    background: transparent;
    color: var(--color-foreground);
  }
  .dt-table :global(.sort-h.active) {
    color: var(--color-accent);
  }
  :global(.sort-h .dim) {
    opacity: 0.35;
    flex-shrink: 0;
  }
  /* Drag grip pinned to the far LEFT edge of every header, regardless of the
	   column's text alignment. Decorative — pointer-events off so the drag
	   (th pointerdown) and the sort/filter controls beneath it still work. */
  :global(.dt-th .grip) {
    position: absolute;
    left: 3px;
    bottom: 0.6rem;
    opacity: 0;
    cursor: grab;
    color: var(--color-muted-foreground);
    transition: opacity var(--duration-fast) var(--ease-standard);
    pointer-events: none;
  }
  .dt-th:hover :global(.grip) {
    opacity: 0.45;
  }
  .dt-resize {
    position: absolute;
    top: 0;
    right: -2px;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    z-index: var(--layer-sticky);
    touch-action: none;
  }
  .dt-resize::after {
    content: '';
    position: absolute;
    top: 25%;
    right: 3px;
    width: 1px;
    height: 50%;
    background: var(--hairline);
    transition: background-color var(--duration-fast) var(--ease-standard);
  }
  .dt-resize:hover::after,
  .dt-resize.resizing::after {
    background: var(--color-accent);
  }

  /* Cells: clip by default (fixed widths); wrap opt-in via context menu. */
  .dt-cell {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dt-cell.dt-wrap {
    white-space: normal;
    word-break: break-word;
    text-overflow: clip;
    overflow: visible;
  }
  /* Wrap must also defeat cell content that hard-codes truncation (e.g. a custom
	   cell's Tailwind `truncate` = nowrap+ellipsis). Two classes beat that utility
	   without !important. */
  .dt-cell.dt-wrap :global(*) {
    white-space: normal;
    text-overflow: clip;
    overflow: visible;
    max-width: none;
  }
  .dt-row.child {
    background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
  }
  /* Roving keyboard focus (j/k, arrows) — subtle, distinct from hover. */
  .dt-row.focused {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
    box-shadow: var(--dt-shadow-before);
  }
  .dt-tree-cell {
    padding-left: calc(var(--space-2) + var(--tree-depth) * var(--space-4));
  }
  /* Table wrapper is the grid-key scope (tabindex=0); suppress the mouse-click
	   focus ring but keep it for keyboard focus. */
  .dt-scroll {
    outline: none;
  }
  .dt-scroll:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  /* Expand toggle + custom block row */
  .dt-table :global(.dt-exp) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    color: var(--color-muted-foreground);
    cursor: pointer;
    transition:
      transform var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard);
  }
  .dt-table :global(.dt-exp:hover) {
    color: var(--color-foreground);
    background: transparent;
  }
  .dt-table :global(.dt-exp.open) {
    transform: rotate(90deg);
    color: var(--color-accent);
  }
  .dt-block-row > .dt-block {
    padding: 0;
    background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
    border-bottom: 1px solid var(--hairline);
  }

  /* ── Themed checkboxes ───────────────────────────────────────────────────
	   Fixed 1rem box in BOTH states (border inside via border-box + padding 0,
	   so the check icon never changes the control's size). Unchecked must read
	   on the row background: strong border on a raised surface. ────────────── */
  .dt-table :global(.dt-check) {
    display: inline-grid;
    place-items: center;
    /* Never baseline-aligned (owner 2026-09-30): an EMPTY inline-grid sits on
       the line box's baseline and gains a descent, so the unchecked box rode
       4 px low and the row's line box grew; checking it (a glyph appears)
       moved the baseline back — the box jumped and every row "shrank". */
    vertical-align: middle;
    box-sizing: border-box;
    width: 1rem;
    height: 1rem;
    padding: 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-2);
    color: transparent;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard);
  }
  .dt-table :global(.dt-check:hover) {
    border-color: var(--color-accent);
    background: var(--color-surface-3);
  }
  /* Row hover promotes the (unchecked) checkbox so the click target is obvious. */
  .dt-row:hover :global(.dt-check:not(.on):not(.ind)) {
    border-color: var(--color-accent);
    background: var(--color-surface-3);
  }
  .dt-table :global(.dt-check.on),
  .dt-table :global(.dt-check.ind) {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-on-accent);
  }

  .dt-inp {
    height: 1.75rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body);
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
  }
  /* ── ID + Title columns (table registry) ───────────────────────────── */
  .dt-cell.dt-id {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  /* Owner directive 2026-09-29: `.dt-open` is the ONLY way into a record now
     (a plain row click no longer navigates — see `resolveRowOpen` — because
     it used to fire out from under a tags/category picker the row click also
     opened). It is right-aligned and, when the column is too narrow for the
     title text, OVERLAYS the text rather than wrapping/pushing — always an
     OPAQUE surface behind it, never see-through. */
  .dt-title {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
  }
  .dt-title-link {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-accent);
  }
  .dt-title-link:hover {
    text-decoration: underline;
  }
  /* Notion: the open affordance appears on row hover / keyboard focus. */
  .dt-open {
    position: absolute;
    right: var(--space-1);
    top: 50%;
    translate: 0 -50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    border-radius: var(--radius-xs);
    color: var(--color-accent);
    background: var(--color-surface-1);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  /* Opaque backing matches whatever the ROW currently paints underneath it
     (default row bg vs. the `.dt-row:hover` bg) so the square never reads as
     a translucent cutout over the title text it overlays. */
  .dt-row:hover .dt-open {
    background: var(--color-bg3);
  }
  .dt-row:hover .dt-open,
  .dt-open:focus-visible,
  .dt-cell.dt-sel-focus .dt-open {
    opacity: 1;
  }
  .dt-open :global(svg) {
    width: 0.75rem;
    height: 0.75rem;
  }
  .dt-open:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg3));
  }
  /* ── Cell editing ───────────────────────────────────────────────────── */
  .dt-cell.dt-editable {
    position: relative;
    cursor: cell;
    user-select: none;
  }
  .dt-cell.dt-sel {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .dt-cell.dt-sel-focus {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
  .dt-cell.dt-fillprev {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
    background: color-mix(in srgb, var(--color-accent) 5%, transparent);
  }
  .dt-cell.dt-pending {
    color: var(--color-text-tertiary);
  }
  .dt-cell.dt-failed {
    outline: 2px solid var(--color-danger-border);
    outline-offset: -2px;
    background: var(--color-danger-surface);
  }
  .dt-cell.dt-editing {
    padding: 0 var(--space-1);
    overflow: visible;
  }
  /* The cell's own selection outline is the editor's single border (Notion):
     the input drops its chrome so the two don't stack into a double frame. */
  .dt-cell.dt-editing :global(.dt-inp) {
    width: 100%;
    min-width: 0;
    border-color: transparent;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    outline: none;
  }
  .dt-fill {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 0.5rem;
    height: 0.5rem;
    background: var(--color-accent);
    border: 1px solid var(--color-on-accent);
    cursor: crosshair;
    z-index: var(--layer-base);
  }
  .dt-bool {
    display: inline-flex;
    width: 1rem;
    height: 1rem;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-xs);
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-2);
    color: var(--color-on-accent);
    vertical-align: middle;
  }
  .dt-bool.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }

  /* ── Column menu ─────────────────────────────────────────────────────── */
  /* Dismissal is a document-level outside-pointerdown + Escape listener (see
     the single `<svelte:document>` near the template root) — governance
     forbids a `position: fixed` backdrop element (an ancestor with
     `backdrop-filter`/`transform`, e.g. the sticky blurred `<thead>`, becomes
     its containing block and silently shrinks the "viewport" backdrop, which
     is also what left the pointer cursor stuck in "pointer" mode everywhere
     while a menu was open). */
  .col-wrap {
    position: relative;
    display: inline-flex;
  }
  .col-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: var(--layer-popover);
    min-width: 13rem;
    max-height: 22rem;
    overflow: auto;
    background: var(--color-card);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-1);
  }
  .col-menu-h {
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    padding: var(--space-1) var(--space-2);
  }
  .col-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border-radius: var(--radius-sm);
  }
  .col-item:hover {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  .col-item.dragging {
    opacity: 0.5;
  }
  :global(.col-item .col-grip) {
    color: var(--color-muted-foreground);
    cursor: grab;
    opacity: 0.5;
    flex-shrink: 0;
    margin-left: var(--space-0-5);
  }
  .col-menu :global(.col-check-btn) {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: auto;
    justify-content: flex-start;
    padding: var(--space-2) var(--space-1);
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .col-menu :global(.col-check-btn > span) {
    width: 100%;
    justify-content: flex-start;
    gap: var(--space-2);
  }
  .col-menu :global(.col-check-btn:hover) {
    background: transparent;
  }
  .col-menu :global(.col-check-btn:disabled) {
    cursor: default;
  }
  .col-check {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    flex-shrink: 0;
    color: var(--color-accent-foreground, var(--color-bg));
  }
  .col-check.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .col-label {
    font-size: var(--font-size-body);
  }

  /* ── Header context menu ─────────────────────────────────────────────── */
  .ctx-menu {
    position: fixed;
    z-index: var(--layer-popover);
    min-width: 12rem;
    background: var(--color-card);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-1);
  }
  .ctx-menu :global(.ctx-item) {
    display: flex;
    align-items: center;
    width: 100%;
    height: auto;
    justify-content: flex-start;
    text-align: left;
    padding: var(--space-2);
    border: none;
    background: transparent;
    font-size: var(--font-size-body);
    font-weight: 400;
    border-radius: var(--radius-sm);
    color: var(--color-foreground);
    cursor: pointer;
  }
  .ctx-menu :global(.ctx-item > span) {
    width: 100%;
    justify-content: flex-start;
    gap: var(--space-2);
  }
  .ctx-menu :global(.ctx-item:hover) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  :global(.ctx-item .ctx-check) {
    margin-left: auto;
    color: var(--color-accent);
  }
  :global(.ctx-item .ctx-chevron) {
    margin-left: auto;
    color: var(--color-muted-foreground);
  }
  /* ── Filter▸ / Aggregate▸ nested flyouts (owner: group these into a nested
       menu) — hover- or click-opened, ArrowRight/ArrowLeft to open/close;
       flips to the LEFT of the parent row near the viewport's right edge
       (`ctxMenu.flip`, computed once at open time in `openCtx`). ─────────── */
  .ctx-parent {
    position: relative;
  }
  .ctx-sub-menu {
    position: absolute;
    top: 0;
    left: 100%;
    margin-left: var(--space-1);
    min-width: 12rem;
    background: var(--color-card);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-1);
    z-index: var(--layer-popover);
  }
  .ctx-sub-menu.flip {
    left: auto;
    right: 100%;
    margin-left: 0;
    margin-right: var(--space-1);
  }
  .ctx-sep {
    height: 1px;
    background: var(--hairline);
    margin: var(--space-1) 0;
  }
  /* ── Public geometry hooks ────────────────────────────────────────────────
     `--dt-row-h`     row height estimate (set inline from `density`)
     `--dt-head-h`    toolbar/header strip height (default 2.25rem)
     `--dt-sticky-bg` opaque paint behind a frozen column — a transparent sticky
                      cell lets the scrolling columns read straight through it.
     Every one is overridable from a caller's `style`/scoped CSS. ───────────── */
  .dt-root {
    --dt-row-h: 44px;
    --dt-head-h: 2.25rem;
    --dt-sticky-bg: var(--color-surface-1);
  }
  /* Density presets: the row estimate above plus the cell padding that actually
     produces it. `normal` adds no class at all, so it stays byte-identical. */
  .dt-compact :global(.dt-cell),
  .dt-compact :global(.dt-th) {
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }
  .dt-comfortable :global(.dt-cell) {
    padding-top: var(--space-3);
    padding-bottom: var(--space-3);
  }

  /* ── Loading skeleton ─────────────────────────────────────────────────── */
  .dt-skeleton {
    display: flex;
    flex-direction: column;
  }
  .dt-skeleton-row {
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--hairline);
  }

  /* ── Filter chip bar ──────────────────────────────────────────────────── */
  /* Right-aligned (owner 2026-09-29): a chip appears under the Filter / Group
     tools that created it, so the eye never has to cross the screen. */
  .dt-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--hairline);
  }
  /* Advanced-rules chip: same pill shape as FilterChip's `.fchip`, always
     accent-tinted (it only renders while `advanced` has ≥1 rule, i.e. active). */
  .dt-adv-chip {
    display: inline-flex;
  }
  .dt-adv-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    min-height: var(--control-height-xs);
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, var(--hairline));
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-2));
    color: var(--color-accent);
    font-size: var(--font-size-label);
    cursor: pointer;
  }
  .dt-chips :global(.dt-chip-clear) {
    height: auto;
    min-height: 0;
    padding: 0;
    border: none;
    background: transparent;
    font-size: var(--font-size-label);
    color: var(--color-accent);
  }
  .dt-chips :global(.dt-chip-clear:hover) {
    background: transparent;
    text-decoration: underline;
  }

  /* ── Group header rows ────────────────────────────────────────────────── */
  .dt-group-row > .dt-group-cell {
    padding: var(--space-1) var(--space-2);
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
    border-bottom: 1px solid var(--hairline);
    white-space: nowrap;
  }
  .dt-group-label {
    font-weight: 600;
    color: var(--color-foreground);
  }
  .dt-group-count {
    margin-left: var(--space-2);
    font-size: var(--font-size-label);
    color: var(--color-muted-foreground);
  }
  .dt-sort-rank {
    font-size: var(--font-size-telemetry);
    color: var(--color-accent);
  }

  /* ── Frozen columns + sticky actions column ───────────────────────────────
     A frozen cell has to outrank its scrolling siblings (some of which are
     `position: relative` for the editing affordances) but must NOT outrank the
     app chrome. `isolation: isolate` on the row makes the contest LOCAL, which
     is the layer contract: order tiers inside a container, never climb the
     global ladder. */
  .dt-has-sticky :global(tr) {
    isolation: isolate;
  }
  .dt-cell.dt-frozen,
  .dt-th.dt-frozen,
  .dt-foot-cell.dt-frozen,
  td.dt-act,
  th.dt-act {
    position: sticky;
    z-index: var(--layer-sticky);
    background: var(--dt-sticky-bg);
  }
  td.dt-act,
  th.dt-act {
    right: 0;
    padding: 0 var(--space-2);
    overflow: visible;
  }
  /* The separator only appears once the pane has actually scrolled sideways, so
     a table that fits shows no stray divider line. */
  .dt-scroll.scrolled-x :global(.dt-frozen-last) {
    border-right: 1px solid var(--hairline);
  }
  .dt-scroll.scrolled-x :global(.dt-act) {
    border-left: 1px solid var(--hairline);
  }
  .dt-row:hover .dt-frozen,
  .dt-row:hover .dt-act {
    background: var(--color-bg3);
  }
  .dt-row-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    width: 100%;
  }
  /* Hover mode: revealed by row hover, keyboard focus inside the row, or the
     roving row focus — never hidden from a keyboard user. */
  .dt-root:not(.dt-actions-always) .dt-row-actions {
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .dt-root:not(.dt-actions-always) .dt-row:hover .dt-row-actions,
  .dt-root:not(.dt-actions-always) .dt-row:focus-within .dt-row-actions,
  .dt-root:not(.dt-actions-always) .dt-row.focused .dt-row-actions {
    opacity: 1;
  }

  /* ── Footer row ───────────────────────────────────────────────────────── */
  .dt-tfoot {
    position: sticky;
    bottom: 0;
    background: var(--color-surface-1);
    z-index: var(--layer-sticky);
  }
  .dt-foot-cell {
    border-top: 1px solid var(--hairline);
    font-size: var(--font-size-label);
    color: var(--color-foreground);
    white-space: nowrap;
  }
  .dt-foot-val {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-variant-numeric: tabular-nums;
  }
</style>
