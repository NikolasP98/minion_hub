/**
 * Tone + icon per stock-entry type, kept dependency-free so it's
 * unit-testable without mounting a component (mirrors `entryStatusVariant`
 * in stock-ui.ts). One map, reused by EntryTypeBadge.svelte and its test.
 */

import type { SemanticValue } from '@minion-stack/ui';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, SlidersHorizontal } from 'lucide-svelte';

export type EntryType = 'receipt' | 'issue' | 'transfer' | 'adjustment';

export interface EntryTypeBadgeSpec {
  value: SemanticValue;
  icon: typeof ArrowDownToLine;
}

export const ENTRY_TYPE_BADGE: Record<EntryType, EntryTypeBadgeSpec> = {
  receipt: { value: 'success', icon: ArrowDownToLine },
  issue: { value: 'error', icon: ArrowUpFromLine },
  transfer: { value: 'info', icon: ArrowLeftRight },
  adjustment: { value: 'warning', icon: SlidersHorizontal },
};

/** Narrowing helper — unknown/legacy type strings fall back to a neutral badge. */
export function entryTypeBadgeSpec(type: string): EntryTypeBadgeSpec | undefined {
  return ENTRY_TYPE_BADGE[type as EntryType];
}
