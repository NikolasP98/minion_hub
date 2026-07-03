/**
 * Pure UI helpers for the /stock module — kept dependency-free so they're
 * unit-testable without mounting a component (mirrors dashboard/editable-grid.ts).
 */

import type { BadgeVariant, SemanticValue } from '@minion-stack/ui';

export type EntryStatus = 'draft' | 'submitted' | 'cancelled';

/** Badge color mapping for entry status pills. */
export function entryStatusVariant(status: string): { variant: BadgeVariant; value: SemanticValue } {
  if (status === 'submitted') return { variant: 'semantic', value: 'success' };
  if (status === 'cancelled') return { variant: 'semantic', value: 'error' };
  return { variant: 'semantic', value: 'info' }; // draft
}

// ── Warehouse tree ──────────────────────────────────────────────────────────

export interface WarehouseRow {
  id: string;
  name: string;
  parentId: string | null;
}
export interface WarehouseTreeRow extends WarehouseRow {
  depth: number;
}

/**
 * Flatten a parent_id tree into a depth-first, indentation-ready list. Orphans
 * (a parentId pointing at a missing/already-visited row — shouldn't happen
 * given the server's cycle guard, but the UI must not infinite-loop on stale
 * data) are surfaced as depth-0 roots rather than dropped, so nothing silently
 * disappears from the editor.
 */
export function buildWarehouseTree(rows: WarehouseRow[]): WarehouseTreeRow[] {
  const byParent = new Map<string | null, WarehouseRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? [];
    list.push(r);
    byParent.set(r.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const out: WarehouseTreeRow[] = [];
  const visited = new Set<string>();

  function walk(parentId: string | null, depth: number) {
    for (const row of byParent.get(parentId) ?? []) {
      if (visited.has(row.id)) continue; // cycle guard — never re-visit
      visited.add(row.id);
      out.push({ ...row, depth });
      walk(row.id, depth + 1);
    }
  }
  walk(null, 0);

  // Anything not reached from a root (dangling parentId) still gets shown.
  for (const r of rows) {
    if (!visited.has(r.id)) {
      visited.add(r.id);
      out.push({ ...r, depth: 0 });
    }
  }
  return out;
}
