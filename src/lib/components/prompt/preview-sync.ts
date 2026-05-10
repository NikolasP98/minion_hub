/**
 * Preview synchronization helpers for the /(app)/prompt route.
 *
 * Extracted from PromptShell so the draftOverride logic is unit-testable without
 * spinning up a Svelte component. The actual $effect + debounce timer live in
 * PromptShell.svelte where they have direct access to the reactive store.
 *
 * Per Phase 20 CONTEXT D-06: debounce is 500ms after last edit. Mode changes
 * trigger an IMMEDIATE re-preview (no debounce) — user expects instant feedback.
 * Per B-2 + T-20-13: draftOverride is ONLY sent for custom sections with unsaved
 * edits, so the server substitutes the live editor body without persisting.
 */
import type { SectionMeta } from "@minion-stack/shared";

export interface DraftOverride {
  id: string;
  body: string;
}

export interface PromptSectionsSnapshot {
  activeId: string | null;
  activeBody: string;
  sections: SectionMeta[];
  isDirty: boolean;
}

/**
 * Determine whether a draftOverride payload should be included in the next
 * preview RPC.
 *
 * Returns `{ id, body }` ONLY when ALL of these hold:
 *   - there is an active section id
 *   - the active section is custom (id starts with `custom.` OR its metadata
 *     has `source === "custom"`)
 *   - the store reports `isDirty === true` (unsaved edits exist)
 *
 * Otherwise returns `undefined` so the server uses persisted on-disk state.
 *
 * Builtin sections are read-only in the editor — never send a draft body for
 * them (the server would still refuse to apply it since T-20-13 restricts
 * substitution to the sections visible during assembly, but the client skips
 * the payload entirely for clarity).
 */
export function buildDraftOverride(
  snapshot: PromptSectionsSnapshot,
): DraftOverride | undefined {
  const { activeId, activeBody, sections, isDirty } = snapshot;
  if (!activeId) return undefined;
  if (!isDirty) return undefined;

  // Custom sections can be identified by id prefix (`custom.*`) OR by the
  // section metadata's `source` field. Prefer the metadata where available —
  // the id-prefix check is a belt-and-suspenders fallback for cases where the
  // sections array hasn't hydrated yet (e.g. just after agent switch).
  const meta = sections.find((s) => s.id === activeId);
  if (meta) {
    if (meta.source !== "custom") return undefined;
  } else if (!activeId.startsWith("custom.")) {
    return undefined;
  }

  return { id: activeId, body: activeBody };
}
