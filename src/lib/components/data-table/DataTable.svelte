<script module lang="ts">
	import type { Snippet } from 'svelte';

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
		 *  so custom cells are switched on `key` inside one `cell` snippet prop.) */
		custom?: boolean;
		align?: 'left' | 'right' | 'center';
		/** Initial width in px (user can resize unless `resizable: false`). */
		width?: number;
		headerClass?: string;
		cellClass?: string;

		/** Clickable sort header. Default true. */
		sortable?: boolean;
		/** Custom comparator (ascending). Default compares `accessor` values. */
		sortFn?: (a: T, b: T) => number;

		/** Enum multi-select filter in the header (uses the shared ColumnFilter). */
		filter?: {
			options: () => { value: string; label: string }[];
			match?: (row: T) => string | string[] | null | undefined;
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

		/** Inline-editable cell. Renders an input in edit mode; the draft value is
		 *  passed to `onSaveRow`. */
		editable?: boolean;
		editType?: 'text' | 'number';

		/** Include in export. Default true. */
		exportable?: boolean;
		/** Export value. Defaults to `accessor`. */
		exportValue?: (row: T) => string | number;
		/** Checked by default in the export dialog. Defaults to `!defaultHidden`. */
		exportDefault?: boolean;
	};

	/** Draft map handed to `onSaveRow` — column `key` → current input string. */
	export type EditDraft = Record<string, string>;

	/** Header-aggregate modes (non-exclusive per column). */
	export type AggMode = 'sum' | 'avg' | 'count';

	/** A bulk action shown in the toolbar kebab when rows are selected. */
	export type BulkAction<T> = {
		label: string;
		danger?: boolean;
		onSelect: (ids: Set<string>, rows: T[]) => void;
	};
</script>

<script lang="ts" generics="T">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import * as m from '$lib/paraglide/messages';
	import {
		ArrowUp,
		ArrowDown,
		ChevronsUpDown,
		ChevronRight,
		Columns3,
		Check,
		Minus,
		Download,
		Plus,
		Pencil,
		X,
		Search,
		GripVertical,
		MoreVertical,
		WrapText,
		Sigma,
		Divide,
		Hash,
	} from 'lucide-svelte';
	import { Button, Tooltip } from '$lib/components/ui';
	import ColumnFilter from '$lib/components/crm/ColumnFilter.svelte';
	import ExportDialog from '$lib/components/crm/ExportDialog.svelte';
	import { downloadCsv, downloadXlsx, type Rows } from '$lib/export/table-export';
	import { createHotkeysAttachment } from '$lib/hotkeys';
	import { createVirtualizer } from '$lib/virtual/virtualizer.svelte';

	let {
		data,
		columns,
		getRowId,
		searchable = true,
		searchPlaceholder,
		searchFields,
		search = $bindable(''),
		exportable = false,
		exportName = 'export',
		selectable = false,
		selectedIds = $bindable(new Set<string>()),
		onSelectionChange,
		bulkActions,
		columnMenu = true,
		reorderable = true,
		resizable = true,
		storageKey,
		onRowClick,
		addLabel,
		onAdd,
		addDisabled = false,
		canEdit = true,
		onSaveRow,
		editDisabled = false,
		initialSort,
		initialFilters,
		// expansion
		getSubRows,
		expandedContent,
		isExpandable,
		// slots
		cell,
		filterOptionIcon,
		toolbar,
		actions,
		emptyMessage,
		class: className = '',
	}: {
		data: T[];
		columns: DataColumn<T>[];
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
		storageKey?: string;
		onRowClick?: (row: T) => void;
		addLabel?: string;
		onAdd?: () => void;
		addDisabled?: boolean;
		canEdit?: boolean;
		onSaveRow?: (row: T, draft: EditDraft) => Promise<boolean | void>;
		editDisabled?: boolean;
		initialSort?: { key: string; dir?: 'asc' | 'desc' };
		initialFilters?: Record<string, string[]>;
		/** Same-shape children rendered as indented sub-rows when a row is expanded. */
		getSubRows?: (row: T) => T[] | null | undefined;
		/** Custom block rendered under a row when expanded (different-shape children). */
		expandedContent?: Snippet<[T]>;
		/** Gate the expand affordance (default: has sub-rows, or `expandedContent` is set). */
		isExpandable?: (row: T) => boolean;
		cell?: Snippet<[T, DataColumn<T>]>;
		filterOptionIcon?: Snippet<[string]>;
		toolbar?: Snippet;
		actions?: Snippet;
		emptyMessage?: string;
		class?: string;
	} = $props();

	const acc = (c: DataColumn<T>) => c.accessor ?? ((row: T) => (row as Record<string, unknown>)[c.key]);
	const editableCols = $derived(columns.filter((c) => c.editable));
	const hasEdit = $derived(!!onSaveRow && editableCols.length > 0);
	const expandEnabled = $derived(!!getSubRows || !!expandedContent);

	// ── Persisted layout: visibility, order, widths, wrap, aggregates ─────────
	// svelte-ignore state_referenced_locally
	let hidden = $state<Set<string>>(new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)));
	// svelte-ignore state_referenced_locally
	let order = $state<string[]>(columns.map((c) => c.key));
	let widths = $state<Record<string, number>>({});
	let wrap = $state<Set<string>>(new Set());
	// Per-column aggregates are NON-exclusive: a value column can show sum + avg +
	// count at once, each as its own icon-prefixed line in the header.
	let aggregates = $state<Record<string, AggMode[]>>({});
	let colMenuOpen = $state(false);

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
				hidden?: string[]; order?: string[]; widths?: Record<string, number>;
				wrap?: string[]; aggregates?: Record<string, AggMode | AggMode[]>;
			};
			const keys = new Set(columns.map((c) => c.key));
			if (s.hidden) hidden = new Set(s.hidden.filter((k) => keys.has(k)));
			if (s.order) {
				const kept = s.order.filter((k) => keys.has(k));
				order = [...kept, ...columns.map((c) => c.key).filter((k) => !kept.includes(k))];
			}
			if (s.widths) widths = Object.fromEntries(Object.entries(s.widths).filter(([k]) => keys.has(k)));
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
			localStorage.setItem(`dt:${storageKey}`, JSON.stringify({ hidden: [...hidden], order, widths, wrap: [...wrap], aggregates }));
	}

	const byKey = $derived(new Map(columns.map((c) => [c.key, c])));
	const orderedColumns = $derived(order.map((k) => byKey.get(k)).filter((c): c is DataColumn<T> => !!c));
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
	const SEL_W = 40, EXP_W = 38, EDIT_W = 76;
	const totalWidth = $derived(
		(selectable ? SEL_W : 0) + (expandEnabled ? EXP_W : 0) + (hasEdit ? EDIT_W : 0) +
			visibleColumns.reduce((s, c, i) => s + dataWidth(c, i), 0),
	);

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
		if (!reorderable || e.button !== 0) return;
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
				if (e.clientX < r.left) { if (!target) target = { key, side: 'before' }; break; }
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
			const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
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
	// Double-click the resize handle → fit the column to its content. Every cell
	// clips (overflow hidden), so scrollWidth is the true content width; take the
	// widest cell in the column (header + body) and pin the column to it.
	function autoFitColumn(c: DataColumn<T>, e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		if (!tableEl) return;
		// Only mounted cells are queryable (virtualized rows off-screen aren't in
		// the DOM) — pre-existing behavior, unchanged by row virtualization.
		let max = 0;
		for (const el of tableEl.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(c.key)}"]`))
			max = Math.max(max, el.scrollWidth);
		if (max > 0) {
			widths = { ...widths, [c.key]: Math.min(640, Math.max(64, max + 8)) };
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

	// ── Header context menu (wrap / sort / aggregate) ─────────────────────────
	let ctxMenu = $state<{ key: string; x: number; y: number } | null>(null);
	function openCtx(c: DataColumn<T>, e: MouseEvent) {
		e.preventDefault();
		ctxMenu = { key: c.key, x: e.clientX, y: e.clientY };
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
			if (c.numeric) { set.add(c.key); continue; }
			for (let i = 0; i < Math.min(data.length, 25); i++) {
				const v = acc(c)(data[i]);
				if (v == null || v === '') continue;
				if (typeof v === 'number' && Number.isFinite(v)) set.add(c.key);
				break;
			}
		}
		return set;
	});
	function aggOne(c: DataColumn<T>, mode: AggMode): string {
		if (mode === 'count') return view.length.toLocaleString();
		const nums = view.map((r) => Number(acc(c)(r))).filter((n) => Number.isFinite(n));
		if (!nums.length) return '—';
		const sum = nums.reduce((a, b) => a + b, 0);
		const out = mode === 'sum' ? sum : sum / nums.length;
		return out.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}
	// All active aggregates for a column, in a stable order, with their values.
	const AGG_ORDER: AggMode[] = ['sum', 'avg', 'count'];
	function aggList(c: DataColumn<T>): { mode: AggMode; value: string }[] {
		const active = aggregates[c.key];
		if (!active?.length) return [];
		return AGG_ORDER.filter((mode) => active.includes(mode)).map((mode) => ({ mode, value: aggOne(c, mode) }));
	}

	// ── Search ───────────────────────────────────────────────────────────────
	const rowText = (row: T) =>
		searchFields ? searchFields(row) : columns.map((c) => String(acc(c)(row) ?? '')).join(' ');

	// ── Enum filters (one Set<string> per filterable column) ─────────────────
	// svelte-ignore state_referenced_locally
	let filters = $state<Record<string, Set<string>>>(
		initialFilters ? Object.fromEntries(Object.entries(initialFilters).map(([k, v]) => [k, new Set(v)])) : {},
	);
	function filterSet(key: string): Set<string> {
		return filters[key] ?? new Set();
	}
	function setFilter(key: string, s: Set<string>) {
		filters = { ...filters, [key]: s };
	}

	// ── Sort ──────────────────────────────────────────────────────────────────
	// svelte-ignore state_referenced_locally
	let sortKey = $state<string | null>(initialSort?.key ?? null);
	// svelte-ignore state_referenced_locally
	let sortDir = $state<'asc' | 'desc'>(initialSort?.dir ?? 'asc');
	function setSort(c: DataColumn<T>, dir: 'asc' | 'desc') {
		if (c.sortable === false) return;
		sortKey = c.key;
		sortDir = dir;
	}
	function toggleSort(c: DataColumn<T>) {
		if (c.sortable === false) return;
		if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else { sortKey = c.key; sortDir = c.align === 'right' ? 'desc' : 'asc'; }
	}
	function defaultCmp(a: unknown, b: unknown): number {
		if (a == null && b == null) return 0;
		if (a == null) return -1;
		if (b == null) return 1;
		if (typeof a === 'number' && typeof b === 'number') return a - b;
		return String(a).localeCompare(String(b), undefined, { numeric: true });
	}

	// ── Pipeline: search → enum filters → sort ───────────────────────────────
	const view = $derived.by(() => {
		const q = search.trim().toLowerCase();
		let list = data;
		if (q) list = list.filter((row) => rowText(row).toLowerCase().includes(q));
		for (const c of columns) {
			if (!c.filter) continue;
			const set = filterSet(c.key);
			if (!set.size) continue;
			const match = c.filter.match ?? ((row: T) => String(acc(c)(row) ?? ''));
			list = list.filter((row) => {
				const v = match(row);
				if (Array.isArray(v)) return v.some((x) => set.has(String(x)));
				return v != null && set.has(String(v));
			});
		}
		if (sortKey) {
			const col = byKey.get(sortKey);
			if (col) {
				const cmp = col.sortFn ?? ((a: T, b: T) => defaultCmp(acc(col)(a), acc(col)(b)));
				const dir = sortDir === 'asc' ? 1 : -1;
				list = [...list].sort((a, b) => dir * cmp(a, b));
			}
		}
		return list;
	});

	// A real filter (search text or an enum filter) is active — as opposed to the
	// windowing that always caps the render count. Only then is "showing N of M"
	// meaningful; unfiltered, the count is just the total row count.
	const filterActive = $derived(
		search.trim().length > 0 || columns.some((c) => c.filter && filterSet(c.key).size > 0),
	);

	let expanded = $state<Set<string>>(new Set());
	function toggleExpand(id: string, e?: Event) {
		e?.stopPropagation();
		const next = new Set(expanded);
		next.has(id) ? next.delete(id) : next.add(id);
		expanded = next;
	}
	const subRowsOf = (row: T) => (getSubRows ? getSubRows(row) ?? [] : []);
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
		| { kind: 'row'; row: T; depth: number; id: string; key: string; itemIndex: number; rowIndex: number }
		| { kind: 'expanded'; row: T; id: string; key: string; itemIndex: number };
	const flatItems = $derived.by(() => {
		const out: FlatItem[] = [];
		let rowIndex = 0;
		const walk = (row: T, depth: number) => {
			const id = getRowId(row);
			out.push({ kind: 'row', row, depth, id, key: id, itemIndex: out.length, rowIndex: rowIndex++ });
			if (!expanded.has(id)) return;
			const kids = subRowsOf(row);
			if (kids.length) for (const k of kids) walk(k, depth + 1);
			else if (expandedContent) out.push({ kind: 'expanded', row, id, key: `${id}::expanded`, itemIndex: out.length });
		};
		for (const row of view) walk(row, 0);
		return out;
	});
	const flatRows = $derived(
		flatItems.filter((fi): fi is FlatItem & { kind: 'row' } => fi.kind === 'row'),
	);

	// Scroll container for the virtualizer (also the roving-focus DOM anchor,
	// bound on the `overflow-auto` wrapper div in the template below).
	let wrapperEl: HTMLDivElement | null = $state(null);
	// Named `rowVirt` (not `v`) — a per-cell `{@const v = ...}` already shadows
	// `v` inside the cell-render scope further down.
	const rowVirt = $derived(
		browser && wrapperEl
			? createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
					count: flatItems.length,
					getScrollElement: () => wrapperEl,
					estimateSize: () => 44,
					getItemKey: (i) => flatItems[i].key,
					overscan: 10,
				})
			: null,
	);
	const measureRow = (node: HTMLTableRowElement) => {
		rowVirt?.measureElement(node);
	};
	// view identity changes (search/filter/sort) → snap back to the top, same
	// intent as the old renderLimit reset.
	$effect(() => {
		view;
		untrack(() => rowVirt?.scrollToOffset(0));
	});

	// ── Selection ──────────────────────────────────────────────────────────────
	function emitSelection(next: Set<string>) {
		selectedIds = next;
		onSelectionChange?.(next, data.filter((r) => next.has(getRowId(r))));
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
	let bulkOpen = $state(false);
	function runBulk(a: BulkAction<T>) {
		bulkOpen = false;
		a.onSelect(selectedIds, data.filter((r) => selectedIds.has(getRowId(r))));
	}

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
		onRowClick?.(row);
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
			wrapperEl?.querySelector<HTMLElement>(`[data-row-index="${focusedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
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
		const danger = bulkActions?.find((a) => a.danger);
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
				callback: () => { if (danger && selectedIds.size > 0) runBulk(danger); },
			},
			{
				hotkey: 'Backspace',
				callback: () => { if (danger && selectedIds.size > 0) runBulk(danger); },
			},
			{
				hotkey: '/',
				callback: () => searchInputEl?.focus(),
				options: { enabled: searchable },
			},
			{ hotkey: 'ArrowDown', callback: () => moveFocus(1) },
			{ hotkey: 'J', callback: () => moveFocus(1) },
			{ hotkey: 'ArrowUp', callback: () => moveFocus(-1) },
			{ hotkey: 'K', callback: () => moveFocus(-1) },
			{
				hotkey: 'Enter',
				callback: () => {
					const fr = flatRows[focusedIndex];
					if (fr) onRowClick?.(fr.row);
				},
			},
			{
				hotkey: 'Space',
				callback: () => {
					if (!selectable) return;
					const fr = flatRows[focusedIndex];
					if (fr) toggleRow(fr.id);
				},
			},
		];
	});

	// ── Inline edit ────────────────────────────────────────────────────────────
	let editingId = $state<string | null>(null);
	let draft = $state<EditDraft>({});
	let editBusy = $state(false);
	let editErr = $state<string | null>(null);
	function startEdit(row: T, e?: Event) {
		e?.stopPropagation();
		editingId = getRowId(row);
		editErr = null;
		const d: EditDraft = {};
		for (const c of editableCols) {
			const v = acc(c)(row);
			d[c.key] = v == null ? '' : String(v);
		}
		draft = d;
	}
	function cancelEdit(e?: Event) {
		e?.stopPropagation();
		editingId = null;
		editErr = null;
	}
	async function commitEdit(row: T, e?: Event) {
		e?.stopPropagation();
		if (!onSaveRow) return;
		editBusy = true;
		editErr = null;
		try {
			const ok = await onSaveRow(row, draft);
			if (ok === false) editErr = m.data_table_save_failed();
			else editingId = null;
		} catch {
			editErr = m.data_table_save_failed();
		} finally {
			editBusy = false;
		}
	}

	// ── Export ──────────────────────────────────────────────────────────────────
	let exportOpen = $state(false);
	const exportColumns = $derived(columns.filter((c) => c.exportable !== false));
	const exportDialogCols = $derived(
		exportColumns.map((c) => ({ key: c.key, label: c.label, default: c.exportDefault ?? !hidden.has(c.key) })),
	);
	function handleExport(format: 'csv' | 'xlsx', keys: string[]) {
		const cols = exportColumns.filter((c) => keys.includes(c.key));
		const val = (c: DataColumn<T>, row: T): string | number => {
			if (c.exportValue) return c.exportValue(row);
			const v = acc(c)(row);
			return v == null ? '' : typeof v === 'number' ? v : String(v);
		};
		const rows: Rows = [cols.map((c) => c.label), ...view.map((row) => cols.map((c) => val(c, row)))];
		const stamp = new Date().toISOString().slice(0, 10);
		const name = `${exportName}-${stamp}.${format}`;
		if (format === 'csv') downloadCsv(name, rows);
		else downloadXlsx(name, rows);
	}

	const colSpan = $derived(visibleColumns.length + (selectable ? 1 : 0) + (expandEnabled ? 1 : 0) + (hasEdit ? 1 : 0));
	function cellAlign(a?: string) {
		return a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
	}
	const dragStyle = (c: DataColumn<T>) =>
		hdrDrag?.active && hdrDrag.key === c.key ? `transform:translateX(${hdrDrag.dx}px)` : undefined;
	const showColMenu = $derived(columnMenu && columns.some((c) => c.hideable !== false || reorderable));
</script>

{#snippet aggIcon(mode: AggMode)}
	{#if mode === 'sum'}<Sigma size={10} />{:else if mode === 'avg'}<Divide size={10} />{:else}<Hash size={10} />{/if}
{/snippet}

<div class="flex flex-col h-full min-h-0 {className}">
	<!-- Toolbar (compact, SAP-style: inline search + icon actions with tooltips) -->
	{#if searchable || exportable || onAdd || showColMenu || toolbar || actions || bulkActions}
		<div class="dt-toolbar">
			{#if searchable}
				<div class="dt-search">
					<Search size={13} class="dt-search-ico" />
					<input bind:this={searchInputEl} bind:value={search} placeholder={searchPlaceholder ?? m.data_table_search()} />
				</div>
			{/if}
			{#if selectedIds.size > 0}
				<span class="dt-count text-accent">{m.data_table_selected({ n: selectedIds.size })}</span>
			{:else}
				<span class="dt-count tabular-nums">
					{#if filterActive}{m.data_table_showing({ shown: view.length, total: data.length })}{:else}{m.data_table_rows({ total: data.length })}{/if}
				</span>
			{/if}

			{#if bulkActions && bulkActions.length && selectedIds.size > 0}
				<div class="col-wrap">
					<Tooltip label={m.data_table_bulk_actions()} asChild>
						{#snippet children(p)}
							<Button variant="ghost" size="xs" {...p} class="dt-tool" aria-label={m.data_table_bulk_actions()} onclick={() => (bulkOpen = !bulkOpen)}>
								<MoreVertical size={15} />
							</Button>
						{/snippet}
					</Tooltip>
					{#if bulkOpen}
						<Button variant="ghost" size="xs" class="backdrop" aria-label="close" onclick={() => (bulkOpen = false)}></Button>
						<div class="col-menu" style="min-width:11rem">
							{#each bulkActions as a (a.label)}
								<Button variant="ghost" size="xs" class={`bulk-item${a.danger ? ' danger' : ''}`} onclick={() => runBulk(a)}>{a.label}</Button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			{@render toolbar?.()}

			<div class="ml-auto flex items-center gap-1">
				{@render actions?.()}
				{#if exportable}
					<Tooltip label={m.data_table_export()} asChild>
						{#snippet children(p)}
							<Button variant="ghost" size="xs" {...p} class="dt-tool" aria-label={m.data_table_export()} onclick={() => (exportOpen = true)}>
								<Download size={15} />
							</Button>
						{/snippet}
					</Tooltip>
				{/if}
				{#if showColMenu}
					<div class="col-wrap">
						<Tooltip label={m.data_table_columns()} asChild>
							{#snippet children(p)}
								<Button variant="ghost" size="xs" {...p} class={`dt-tool${hidden.size > 0 ? ' active-col' : ''}`} aria-label={m.data_table_columns()} onclick={() => (colMenuOpen = !colMenuOpen)}>
									<Columns3 size={15} />
								</Button>
							{/snippet}
						</Tooltip>
						{#if colMenuOpen}
							<Button variant="ghost" size="xs" class="backdrop" aria-label="close" onclick={() => (colMenuOpen = false)}></Button>
							<div class="col-menu">
								<div class="col-menu-h">{m.data_table_columns_heading()}</div>
								{#each orderedColumns as c (c.key)}
									{@const canHide = c.hideable !== false}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="col-item"
										class:dragging={menuDragKey === c.key}
										draggable={reorderable}
										ondragstart={reorderable ? () => (menuDragKey = c.key) : undefined}
										ondragover={reorderable ? (e) => e.preventDefault() : undefined}
										ondrop={reorderable ? () => onMenuDrop(c.key) : undefined}
									>
										{#if reorderable}<GripVertical size={12} class="col-grip" />{/if}
										<Button variant="ghost" size="xs" class="col-check-btn" disabled={!canHide} aria-label={c.label} onclick={() => canHide && toggleHidden(c.key)}>
											<span class="col-check" class:on={!hidden.has(c.key)}>
												{#if !hidden.has(c.key)}<Check size={11} />{/if}
											</span>
											<span class="col-label">{c.label}</span>
										</Button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				{#if onAdd}
					<Tooltip label={addLabel ?? m.data_table_add()} asChild>
						{#snippet children(p)}
							<Button variant="ghost" size="xs" {...p} class="dt-add" aria-label={addLabel ?? m.data_table_add()} disabled={addDisabled} onclick={onAdd}>
								<Plus size={16} />
							</Button>
						{/snippet}
					</Tooltip>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Table -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="flex-1 min-h-0 overflow-auto dt-scroll" tabindex="0" bind:this={wrapperEl} {@attach gridAttachment}>
		{#if data.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
				<p class="t-caption">{emptyMessage ?? m.data_table_empty()}</p>
			</div>
		{:else}
			<table bind:this={tableEl} class="dt-table text-sm" class:dragging={hdrDrag?.active} style="width:100%; min-width:{totalWidth}px">
				<colgroup>
					{#if selectable}<col style="width:{SEL_W}px" />{/if}
					{#if expandEnabled}<col style="width:{EXP_W}px" />{/if}
					{#each visibleColumns as c, i (c.key)}<col style="width:{dataWidth(c, i)}px" />{/each}
					{#if hasEdit}<col style="width:{EDIT_W}px" />{/if}
					<!-- spacer: absorbs leftover width when the table is narrower than the pane;
					     collapses to 0 (min-width forces horizontal scroll) when it overflows -->
					<col />
				</colgroup>
				<thead class="sticky top-0 bg-bg/95 backdrop-blur z-[var(--layer-navigation)]" bind:this={theadEl}>
					<tr class="text-left t-caption border-b border-[var(--hairline)]">
						{#if selectable}
							<th class="dt-th px-3 py-2">
								<Button variant="ghost" size="xs" class={`dt-check is-master${allSelected ? ' on' : ''}${someSelected ? ' ind' : ''}`}
									role="checkbox" aria-checked={someSelected ? 'mixed' : allSelected} aria-label={m.data_table_select_all()} onclick={toggleAll}>
									{#if someSelected}<Minus size={11} />{:else if allSelected}<Check size={11} />{/if}
								</Button>
							</th>
						{/if}
						{#if expandEnabled}<th class="dt-th"></th>{/if}
						{#each visibleColumns as c, i (c.key)}
							{@const sorted = sortKey === c.key}
							{@const aggs = aggList(c)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<th
								data-col={c.key}
								class="dt-th px-3 py-2 font-medium {cellAlign(c.align)} {c.headerClass ?? ''}"
								class:dragging={hdrDrag?.active && hdrDrag.key === c.key}
								class:drop-before={dropTarget?.key === c.key && dropTarget.side === 'before'}
								class:drop-after={dropTarget?.key === c.key && dropTarget.side === 'after'}
								style={dragStyle(c)}
								onpointerdown={(e) => onHeaderPointerDown(c, e)}
								oncontextmenu={(e) => openCtx(c, e)}
							>
								{#if reorderable}<GripVertical size={11} class="grip" />{/if}
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
								<div class="flex items-center gap-1 {c.align === 'right' ? 'justify-end' : c.align === 'center' ? 'justify-center' : ''}">
									{#if c.filter}
										<ColumnFilter label={c.label} options={c.filter.options()} selected={filterSet(c.key)}
											align={c.filter.align ?? (c.align === 'right' ? 'right' : 'left')}
											optionIcon={c.filter.icon ? filterOptionIcon : undefined} onSelect={(s) => setFilter(c.key, s)} />
									{:else if c.sortable !== false}
										<Button variant="ghost" size="xs" class={`sort-h${sorted ? ' active' : ''}`} onclick={() => toggleSort(c)}>
											<span class="dt-hlabel">{c.label}</span>
											{#if sorted}
												{#if sortDir === 'asc'}<ArrowUp size={12} />{:else}<ArrowDown size={12} />{/if}
											{:else}<ChevronsUpDown size={11} class="dim" />{/if}
										</Button>
									{:else}
										<span class="dt-hlabel">{c.label}</span>
									{/if}
								</div>
								{#if resizable && c.resizable !== false}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span class="dt-resize" class:resizing={resizeKey === c.key}
										onpointerdown={(e) => onResizeDown(c, i, e)}
										ondblclick={(e) => autoFitColumn(c, e)} title={m.data_table_fit_column()}></span>
								{/if}
							</th>
						{/each}
						{#if hasEdit}<th class="dt-th px-3 py-2"></th>{/if}
						<th class="dt-th" aria-hidden="true"></th>
					</tr>
				</thead>
				<tbody>
					{#if view.length === 0}
						<tr><td colspan={colSpan + 1} class="px-4 py-8 text-center t-caption text-muted-foreground">{m.data_table_no_match()}</td></tr>
					{:else if rowVirt}
						{@const vItems = rowVirt.getVirtualItems()}
						<!-- Spacer rows (not absolutely-positioned <tr>s — that breaks table
						     layout/sticky-thead) absorb the space above/below the rendered
						     window so the scrollbar reflects the FULL flattened list. -->
						<tr style="height:{vItems[0]?.start ?? 0}px" aria-hidden="true"></tr>
						{#each vItems as vi (vi.key)}
							{@const fi = flatItems[vi.index]}
							{#if fi.kind === 'expanded'}
								<tr class="dt-block-row" data-index={vi.index} {@attach measureRow}>
									<td colspan={colSpan + 1} class="dt-block">{@render expandedContent?.(fi.row)}</td>
								</tr>
							{:else}
								{@const row = fi.row}
								{@const id = fi.id}
								{@const editing = editingId === id}
								{@const canExpand = rowExpandable(row)}
								{@const isOpen = expanded.has(id)}
								<tr
									data-row-index={fi.rowIndex}
									data-index={vi.index}
									{@attach measureRow}
									class="dt-row border-b border-[var(--hairline)] hover:bg-bg3 transition-colors {onRowClick && !editing ? 'cursor-pointer' : ''}"
									class:child={fi.depth > 0}
									class:focused={focusedIndex === fi.rowIndex}
									onclick={!editing && (selectable || onRowClick) ? (e) => handleRowClick(id, row, e) : undefined}
								>
									{#if selectable}
										<td class="px-3 py-2">
													<Button variant="ghost" size="xs" class={`dt-check is-row${selectedIds.has(id) ? ' on' : ''}`} role="checkbox" aria-checked={selectedIds.has(id)} aria-label="select row" onclick={(e) => toggleRow(id, e)}>
												{#if selectedIds.has(id)}<Check size={11} />{/if}
											</Button>
										</td>
									{/if}
									{#if expandEnabled}
										<td class="dt-tree-cell px-1 py-2 text-center" style="--tree-depth:{fi.depth}">
											{#if canExpand}
														<Button variant="ghost" size="xs" class={`dt-exp${isOpen ? ' open' : ''}`} aria-label={isOpen ? m.data_table_collapse() : m.data_table_expand()} onclick={(e) => toggleExpand(id, e)}>
													<ChevronRight size={13} />
												</Button>
											{/if}
										</td>
									{/if}
									{#each visibleColumns as c (c.key)}
										<td data-col={c.key} class="dt-cell px-3 py-2 {cellAlign(c.align)} {c.cellClass ?? ''}" class:dt-wrap={wrap.has(c.key)} style={dragStyle(c)}>
											{#if editing && c.editable}
												<input class="dt-inp {c.align === 'right' ? 'text-right w-24' : 'w-full'}" type={c.editType === 'number' ? 'number' : 'text'}
													step={c.editType === 'number' ? 'any' : undefined} bind:value={draft[c.key]} onclick={(e) => e.stopPropagation()} />
											{:else if c.custom && cell}
												{@render cell(row, c)}
											{:else}
												{@const v = acc(c)(row)}
												{v == null || v === '' ? '—' : v}
											{/if}
										</td>
									{/each}
									{#if hasEdit}
										<td class="px-3 py-2 text-right">
											{#if editing}
												<div class="flex gap-1 justify-end">
													<Button variant="ghost" size="xs" class="act-btn act-save" onclick={(e) => commitEdit(row, e)} disabled={editBusy} title={m.data_table_save()}><Check size={13} /></Button>
													<Button variant="ghost" size="xs" class="act-btn" onclick={cancelEdit} title={m.data_table_cancel()}><X size={13} /></Button>
												</div>
												{#if editErr}<p class="err-msg text-xs">{editErr}</p>{/if}
											{:else}
												<Button variant="ghost" size="xs" class="act-btn act-edit" onclick={(e) => startEdit(row, e)} disabled={editDisabled || !canEdit} title={canEdit ? m.data_table_edit() : m.no_permission()}><Pencil size={13} /></Button>
											{/if}
										</td>
									{/if}
									<td aria-hidden="true"></td>
								</tr>
							{/if}
						{/each}
						<tr style="height:{rowVirt.getTotalSize() - (vItems[vItems.length - 1]?.end ?? 0)}px" aria-hidden="true"></tr>
					{/if}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<!-- Header context menu -->
{#if ctxMenu}
	{@const cc = byKey.get(ctxMenu.key)}
	<Button variant="ghost" size="xs" class="backdrop" aria-label="close" onclick={() => (ctxMenu = null)} oncontextmenu={(e: MouseEvent) => { e.preventDefault(); ctxMenu = null; }}></Button>
	<div class="ctx-menu" style="left:{ctxMenu.x}px; top:{ctxMenu.y}px">
		{#if cc}
			{#if cc.sortable !== false}
				<Button variant="ghost" size="xs" class="ctx-item" onclick={() => { setSort(cc, 'asc'); ctxMenu = null; }}><ArrowUp size={13} /> {m.data_table_sort_asc()}</Button>
				<Button variant="ghost" size="xs" class="ctx-item" onclick={() => { setSort(cc, 'desc'); ctxMenu = null; }}><ArrowDown size={13} /> {m.data_table_sort_desc()}</Button>
				<div class="ctx-sep"></div>
			{/if}
			<Button variant="ghost" size="xs" class="ctx-item" onclick={() => { toggleWrap(cc.key); ctxMenu = null; }}>
				<WrapText size={13} /> {m.data_table_wrap_text()}
				{#if wrap.has(cc.key)}<Check size={12} class="ctx-check" />{/if}
			</Button>
			{#if numericKeys.has(cc.key)}
				<div class="ctx-sep"></div>
				<div class="ctx-h"><Sigma size={11} /> {m.data_table_aggregate()}</div>
				{#each [['sum', m.data_table_agg_sum()], ['avg', m.data_table_agg_avg()], ['count', m.data_table_agg_count()]] as [mode, label] (mode)}
					<!-- non-exclusive: toggle each; menu stays open so several can be enabled -->
					<Button variant="ghost" size="xs" class="ctx-item ctx-sub" onclick={() => toggleAggregate(cc.key, mode as AggMode)}>
						{@render aggIcon(mode as AggMode)}
						{label}
						{#if aggregates[cc.key]?.includes(mode as AggMode)}<Check size={12} class="ctx-check" />{/if}
					</Button>
				{/each}
			{/if}
		{/if}
	</div>
{/if}

{#if exportable}
	<ExportDialog bind:open={exportOpen} columns={exportDialogCols} count={view.length} onexport={handleExport} />
{/if}

<style>
	/* ── Compact toolbar ─────────────────────────────────────────────────── */
	.dt-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--hairline); min-height: 2.25rem; }
	.dt-count { font-size: var(--font-size-label); color: var(--color-muted-foreground); white-space: nowrap; }
	.dt-search { position: relative; display: inline-flex; align-items: center; min-width: 9rem; }
	:global(.dt-search .dt-search-ico) { position: absolute; left: 0.35rem; color: var(--color-muted-foreground); pointer-events: none; }
	.dt-search input { height: 1.65rem; width: 100%; padding: 0 var(--space-2) 0 var(--space-6); font-size: var(--font-size-body); color: var(--color-foreground); background: transparent; border: 1px solid transparent; border-bottom-color: var(--hairline); border-radius: var(--radius-sm); transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard); }
	.dt-search input::placeholder { color: var(--color-muted-foreground); opacity: 0.7; }
	.dt-search input:hover { background: color-mix(in srgb, var(--color-foreground) 4%, transparent); }
	.dt-search input:focus { outline: none; background: var(--color-bg3); border-color: color-mix(in srgb, var(--color-accent) 55%, transparent); }
	.dt-tool { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: var(--radius-sm); color: var(--color-muted-foreground); background: transparent; cursor: pointer; transition: background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard); }
	.dt-tool:hover { background: color-mix(in srgb, var(--color-foreground) 8%, transparent); color: var(--color-foreground); }
	.dt-tool.active-col { color: var(--color-accent); }
	.dt-add { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-on-accent); cursor: pointer; transition: filter var(--duration-fast) var(--ease-standard); }
	.dt-add:hover { filter: brightness(1.08); }
	.dt-add:disabled { opacity: 0.5; cursor: not-allowed; }
	.bulk-item { display: block; width: 100%; text-align: left; padding: var(--space-2); font-size: var(--font-size-body); border-radius: var(--radius-sm); color: var(--color-foreground); cursor: pointer; }
	.bulk-item:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
	.bulk-item.danger { color: var(--color-destructive); }
	.bulk-item.danger:hover { background: color-mix(in srgb, var(--color-destructive) 12%, transparent); }

	/* ── Table + fixed layout (resize one col → others hold; scroll x) ─────── */
	.dt-table { --dt-shadow-before: inset 2px 0 0 0 var(--color-accent); --dt-shadow-after: inset -2px 0 0 0 var(--color-accent); table-layout: fixed; border-collapse: collapse; }
	/* vertical-align:bottom pins every header's title to the cell bottom, so
	   titles line up across columns no matter how many aggregates stack above. */
	.dt-th { position: relative; user-select: none; vertical-align: bottom; }
	.dt-table.dragging .dt-th { cursor: grabbing; }
	.dt-th.dragging { z-index: var(--layer-dropdown); background: var(--color-card); box-shadow: var(--shadow-elevation-3); opacity: 0.97; cursor: grabbing; }
	.dt-th.drop-before { box-shadow: var(--dt-shadow-before); }
	.dt-th.drop-after { box-shadow: var(--dt-shadow-after); }
	.dt-hlabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	/* Aggregates always stack vertically, above the title, right-aligned so the
	   value column lines up and the trailing icon sits under the sort/filter arrow. */
	.dt-agg-row { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-0-5); margin-bottom: var(--space-1); }
	/* Desaturated vs the pure accent a sorted header uses, so aggregate figures
	   read as secondary and don't get confused with the active-sort colour.
	   Override --dt-agg-color to retune. */
	.dt-agg { display: inline-flex; align-items: center; gap: var(--space-0-5); font-size: var(--font-size-telemetry); font-weight: 600; color: var(--dt-agg-color, color-mix(in srgb, var(--color-accent) 45%, var(--color-muted-foreground))); font-variant-numeric: tabular-nums; }
	.sort-h { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; font: inherit; color: inherit; cursor: pointer; }
	.sort-h.active { color: var(--color-accent); }
	:global(.sort-h .dim) { opacity: 0.35; flex-shrink: 0; }
	/* Drag grip pinned to the far LEFT edge of every header, regardless of the
	   column's text alignment. Decorative — pointer-events off so the drag
	   (th pointerdown) and the sort/filter controls beneath it still work. */
	:global(.dt-th .grip) { position: absolute; left: 3px; bottom: 0.6rem; opacity: 0; cursor: grab; color: var(--color-muted-foreground); transition: opacity var(--duration-fast) var(--ease-standard); pointer-events: none; }
	.dt-th:hover :global(.grip) { opacity: 0.45; }
	.dt-resize { position: absolute; top: 0; right: -2px; width: 7px; height: 100%; cursor: col-resize; z-index: var(--layer-sticky); touch-action: none; }
	.dt-resize::after { content: ''; position: absolute; top: 25%; right: 3px; width: 1px; height: 50%; background: var(--hairline); transition: background-color var(--duration-fast) var(--ease-standard); }
	.dt-resize:hover::after, .dt-resize.resizing::after { background: var(--color-accent); }

	/* Cells: clip by default (fixed widths); wrap opt-in via context menu. */
	.dt-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.dt-cell.dt-wrap { white-space: normal; word-break: break-word; text-overflow: clip; overflow: visible; }
	/* Wrap must also defeat cell content that hard-codes truncation (e.g. a custom
	   cell's Tailwind `truncate` = nowrap+ellipsis). Two classes beat that utility
	   without !important. */
	.dt-cell.dt-wrap :global(*) { white-space: normal; text-overflow: clip; overflow: visible; max-width: none; }
	.dt-row.child { background: color-mix(in srgb, var(--color-foreground) 3%, transparent); }
	/* Roving keyboard focus (j/k, arrows) — subtle, distinct from hover. */
	.dt-row.focused { background: color-mix(in srgb, var(--color-accent) 8%, transparent); box-shadow: var(--dt-shadow-before); }
	.dt-tree-cell { padding-left: calc(var(--space-2) + var(--tree-depth) * var(--space-4)); }
	/* Table wrapper is the grid-key scope (tabindex=0); suppress the mouse-click
	   focus ring but keep it for keyboard focus. */
	.dt-scroll { outline: none; }
	.dt-scroll:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }

	/* Expand toggle + custom block row */
	.dt-exp { display: inline-flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; border-radius: var(--radius-sm); color: var(--color-muted-foreground); cursor: pointer; transition: transform var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard); }
	.dt-exp:hover { color: var(--color-foreground); }
	.dt-exp.open { transform: rotate(90deg); color: var(--color-accent); }
	.dt-block-row > .dt-block { padding: 0; background: color-mix(in srgb, var(--color-foreground) 3%, transparent); border-bottom: 1px solid var(--hairline); }

	/* ── Themed checkboxes ───────────────────────────────────────────────── */
	.dt-check { display: inline-grid; place-items: center; width: 1rem; height: 1rem; border-radius: var(--radius-sm); border: 1px solid; cursor: pointer; flex-shrink: 0; transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard); }
	.dt-check.is-row { border-color: color-mix(in srgb, var(--color-muted-foreground) 45%, transparent); background: transparent; color: transparent; }
	.dt-check.is-row:hover { border-color: color-mix(in srgb, var(--color-accent) 60%, transparent); }
	.dt-check.is-row.on { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-foreground, var(--color-bg)); }
	.dt-check.is-master { border-color: color-mix(in srgb, var(--color-muted-foreground) 70%, transparent); background: var(--color-bg3); color: transparent; }
	.dt-check.is-master.on, .dt-check.is-master.ind { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-foreground, var(--color-bg)); }

	.dt-inp { height: 1.75rem; padding: 0 var(--space-2); font-size: var(--font-size-body); border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); }
	.act-btn { display: inline-flex; align-items: center; justify-content: center; width: 1.6rem; height: 1.6rem; border-radius: var(--radius-sm); border: 1px solid var(--hairline); background: transparent; cursor: pointer; color: var(--color-muted-foreground); transition: background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard); }
	.act-btn:hover { background: var(--color-surface-2); color: var(--color-foreground); }
	.act-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.act-save { color: var(--color-accent); }
	.act-edit { opacity: 0.6; }
	.err-msg { font-size: var(--font-size-label); color: var(--color-destructive); }

	/* ── Column menu ─────────────────────────────────────────────────────── */
	.col-wrap { position: relative; display: inline-flex; }
	.backdrop { position: fixed; inset: 0; z-index: var(--layer-dropdown); background: transparent; }
	.col-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: var(--layer-popover); min-width: 13rem; max-height: 22rem; overflow: auto; background: var(--color-card); border: 1px solid var(--hairline); border-radius: var(--radius-md); box-shadow: var(--shadow-overlay); padding: var(--space-1); }
	.col-menu-h { font-size: var(--font-size-telemetry); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); padding: var(--space-1) var(--space-2); }
	.col-item { display: flex; align-items: center; gap: var(--space-2); border-radius: var(--radius-sm); }
	.col-item:hover { background: color-mix(in srgb, var(--color-accent) 8%, transparent); }
	.col-item.dragging { opacity: 0.5; }
	:global(.col-item .col-grip) { color: var(--color-muted-foreground); cursor: grab; opacity: 0.5; flex-shrink: 0; margin-left: var(--space-0-5); }
	.col-check-btn { display: flex; align-items: center; gap: var(--space-2); flex: 1; padding: var(--space-2) var(--space-1); text-align: left; cursor: pointer; }
	.col-check-btn:disabled { cursor: default; }
	.col-check { display: grid; place-items: center; width: 1rem; height: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--hairline); flex-shrink: 0; color: var(--color-accent-foreground, var(--color-bg)); }
	.col-check.on { background: var(--color-accent); border-color: var(--color-accent); }
	.col-label { font-size: var(--font-size-body); }

	/* ── Header context menu ─────────────────────────────────────────────── */
	.ctx-menu { position: fixed; z-index: var(--layer-popover); min-width: 12rem; background: var(--color-card); border: 1px solid var(--hairline); border-radius: var(--radius-md); box-shadow: var(--shadow-overlay); padding: var(--space-1); }
	.ctx-item { display: flex; align-items: center; gap: var(--space-2); width: 100%; text-align: left; padding: var(--space-2); font-size: var(--font-size-body); border-radius: var(--radius-sm); color: var(--color-foreground); cursor: pointer; }
	.ctx-item:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
	.ctx-item.ctx-sub { padding-left: var(--space-6); }
	:global(.ctx-item .ctx-check) { margin-left: auto; color: var(--color-accent); }
	.ctx-h { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-telemetry); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); padding: var(--space-1) var(--space-2); }
	.ctx-sep { height: 1px; background: var(--hairline); margin: var(--space-1) 0; }
</style>
