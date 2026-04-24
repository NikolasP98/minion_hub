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

export const promptSections = $state({
    /** Selected agent id — null means the EmptyState is rendered. */
    agentId: null as string | null,
    /** Section metadata (builtin + custom) returned by `prompt.sections.list`. */
    sections: [] as SectionMeta[],
    /** Builtin section ids the operator has disabled via `overrides.set`. */
    disabledOverrides: [] as string[],
    /** Currently focused section id in the editor pane. */
    activeId: null as string | null,
    /** YAML body for the active custom section (ignored for builtins). */
    activeBody: "" as string,
    /** True when activeBody or disabledOverrides differ from last persisted state. */
    isDirty: false,
    /** True while `prompt.sections.list`/`get` is in flight. */
    isLoading: false,
    /** Preview assembly mode — wired from the topbar mode dropdown. */
    mode: "full" as PromptMode,
    /** Last preview response; null until first preview request resolves. */
    preview: null as PreviewResponse | null,
    /** True while `prompt.sections.preview` is in flight (debounced). */
    previewLoading: false,
    /** Inline violations raised by the safety scanner during preview/upsert. */
    validationErrors: [] as SectionViolation[],
});

/**
 * Reset the store for a new agent (or to the empty state when `agentId` is null).
 * Keeps `mode` intact so the operator's last-selected assembly mode persists
 * across agent switches.
 */
export function resetPromptSectionsForAgent(agentId: string | null) {
    promptSections.agentId = agentId;
    promptSections.sections = [];
    promptSections.disabledOverrides = [];
    promptSections.activeId = null;
    promptSections.activeBody = "";
    promptSections.isDirty = false;
    promptSections.isLoading = false;
    promptSections.preview = null;
    promptSections.previewLoading = false;
    promptSections.validationErrors = [];
}

/** Clear active editor selection (e.g. after delete or switching list filters). */
export function clearActiveSection() {
    promptSections.activeId = null;
    promptSections.activeBody = "";
    promptSections.isDirty = false;
    promptSections.validationErrors = [];
}
