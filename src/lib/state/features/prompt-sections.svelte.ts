/**
 * Prompt Sections state store.
 *
 * Single-agent $state store backing the `/(app)/prompt` route. Holds the section
 * list, active-editor selection, unsaved YAML body, overrides disable list, live
 * preview response, and validation errors. Actions mutate the store directly —
 * consumers should read/write `promptSections.*` and call the helper functions
 * exported below when resetting state (e.g. on agent switch).
 *
 * See Phase 20 CONTEXT D-08 for the field shape and Phase 20-02 plan for the
 * pane-scaffolding that consumes it.
 */
import type {
    SectionMeta,
    PreviewResponse,
    PromptMode,
    SectionViolation,
} from "@minion-stack/shared";
import type { SectionUsageMap, SectionUsageAgentRef } from "$lib/services/prompt-sections-rpc";

export const promptSections = $state({
    agentId: null as string | null,
    sections: [] as SectionMeta[],
    disabledOverrides: [] as string[],
    /** Multi-selection: ids highlighted in the assembled pane and concat'd in
     * the detail pane. Insertion order is preserved (Set iteration order). */
    selectedIds: new Set<string>(),
    /** Layer keys collapsed in the breakdown tree. Default: all expanded. */
    collapsedGroups: new Set<string>(),
    /** Single-edit cursor: the one custom section currently being edited inline.
     * Null unless exactly one custom section is selected and the user is typing. */
    activeId: null as string | null,
    activeBody: "" as string,
    isDirty: false,
    isLoading: false,
    mode: "full" as PromptMode,
    preview: null as PreviewResponse | null,
    previewLoading: false,
    validationErrors: [] as SectionViolation[],
    /** Phase 25: cross-agent usage inverse index. Refreshed on agent change +
     * relevant prompt.section.* events. Optimistic local edits in toggle
     * handlers keep it in sync with on-screen state without server roundtrip. */
    usage: {} as SectionUsageMap,
});

/** Optimistic local mutation: add or remove an agent from a section's usage. */
export function patchUsage(
    sectionId: string,
    agent: SectionUsageAgentRef,
    nowEnabled: boolean,
) {
    const map = { ...promptSections.usage };
    const current = map[sectionId] ?? [];
    const without = current.filter((a) => a.agentId !== agent.agentId);
    map[sectionId] = nowEnabled
        ? [...without, agent].sort((a, b) => a.label.localeCompare(b.label))
        : without;
    promptSections.usage = map;
}

export function toggleSelected(id: string, force?: boolean) {
    const next = new Set(promptSections.selectedIds);
    const want = force ?? !next.has(id);
    if (want) next.add(id);
    else next.delete(id);
    promptSections.selectedIds = next;
    // Keep activeId in sync with single-selection (for inline edit).
    promptSections.activeId = next.size === 1 ? [...next][0] : null;
    if (next.size !== 1) {
        promptSections.activeBody = "";
        promptSections.isDirty = false;
    }
}

export function toggleGroupSelected(layerKey: string, members: string[]) {
    const next = new Set(promptSections.selectedIds);
    const allSelected = members.every((id) => next.has(id));
    if (allSelected) for (const id of members) next.delete(id);
    else for (const id of members) next.add(id);
    promptSections.selectedIds = next;
    promptSections.activeId = next.size === 1 ? [...next][0] : null;
    if (next.size !== 1) {
        promptSections.activeBody = "";
        promptSections.isDirty = false;
    }
    void layerKey;
}

export function clearSelection() {
    promptSections.selectedIds = new Set();
    promptSections.activeId = null;
    promptSections.activeBody = "";
    promptSections.isDirty = false;
    promptSections.validationErrors = [];
}

export function toggleGroupCollapsed(layerKey: string) {
    const next = new Set(promptSections.collapsedGroups);
    if (next.has(layerKey)) next.delete(layerKey);
    else next.add(layerKey);
    promptSections.collapsedGroups = next;
}

/**
 * Reset the store for a new agent (or to the empty state when `agentId` is null).
 * Keeps `mode` intact so the operator's last-selected assembly mode persists
 * across agent switches.
 */
export function resetPromptSectionsForAgent(agentId: string | null) {
    promptSections.agentId = agentId;
    promptSections.sections = [];
    promptSections.disabledOverrides = [];
    promptSections.selectedIds = new Set();
    promptSections.collapsedGroups = new Set();
    promptSections.activeId = null;
    promptSections.activeBody = "";
    promptSections.isDirty = false;
    promptSections.isLoading = false;
    promptSections.preview = null;
    promptSections.previewLoading = false;
    promptSections.validationErrors = [];
    // Keep `usage` between agent switches — it's gateway-wide and stays valid.
}

/** Clear active editor selection (e.g. after delete or switching list filters). */
export function clearActiveSection() {
    promptSections.activeId = null;
    promptSections.activeBody = "";
    promptSections.isDirty = false;
    promptSections.validationErrors = [];
}
