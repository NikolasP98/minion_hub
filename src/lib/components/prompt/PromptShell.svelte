<script lang="ts">
    import * as splitter from "@zag-js/splitter";
    import { normalizeProps, useMachine } from "@zag-js/svelte";
    import { promptSections } from "$lib/state/features/prompt-sections.svelte";
    import EmptyState from "./EmptyState.svelte";
    import PromptTopbarChip from "./PromptTopbarChip.svelte";
    import SectionBrowser from "./SectionBrowser.svelte";
    import SectionEditor from "./SectionEditor.svelte";
    import PreviewPanel from "./PreviewPanel.svelte";
    import { previewSections } from "$lib/services/prompt-sections-rpc";
    import { toastError } from "$lib/state/ui/toast.svelte";
    import { buildDraftOverride } from "./preview-sync";

    // Minor type drift between @zag-js/svelte@1.35.2 and @zag-js/splitter@1.35.3
    // (schema generic type narrowing). Safe to cast — runtime API is compatible.
    const service = useMachine(splitter.machine as never, () => ({
        id: "prompt-splitter",
        panels: [
            { id: "browser", minSize: 15, maxSize: 40 },
            { id: "editor", minSize: 25 },
            { id: "preview", minSize: 20, maxSize: 50 },
        ],
        defaultSize: [25, 40, 35],
    }));
    const api = $derived(
        splitter.connect(service as never, normalizeProps)
    );

    // ─── Preview sync (20-04 Task 2) ───────────────────────────────────────
    // Two effects drive `promptSections.preview`:
    //   1. Immediate fetch on agentId / mode change (no debounce per D-06 —
    //      mode dropdown must feel instant).
    //   2. Debounced fetch (500ms per D-06, T-20-11) on edit / toggle / save /
    //      active-section change. Passes draftOverride when the active custom
    //      section has unsaved edits (B-2 fix — server substitutes the draft
    //      body during in-memory assembly).
    // A shared `previewToken` protects against stale responses racing a fresh
    // fetch (agent switch mid-flight).
    let previewToken = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function runPreview(includeDraftOverride: boolean) {
        if (!promptSections.agentId) return;
        const token = ++previewToken;
        const draftOverride = includeDraftOverride
            ? buildDraftOverride({
                  activeId: promptSections.activeId,
                  activeBody: promptSections.activeBody,
                  sections: promptSections.sections,
                  isDirty: promptSections.isDirty,
              })
            : undefined;
        promptSections.previewLoading = true;
        try {
            const res = await previewSections(
                promptSections.agentId,
                promptSections.mode,
                draftOverride,
            );
            if (token !== previewToken) return; // stale
            promptSections.preview = res;
        } catch (err) {
            if (token !== previewToken) return;
            promptSections.preview = null;
            toastError("Preview failed", (err as Error).message);
        } finally {
            if (token === previewToken) {
                promptSections.previewLoading = false;
            }
        }
    }

    function schedulePreview() {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void runPreview(true);
        }, 500);
    }

    // Effect 1: immediate re-preview on agent OR mode change.
    // These are explicit user actions where instant feedback matters; also
    // skipping draftOverride here is correct since mode change shouldn't
    // suddenly expose unsaved edits that weren't yet flowing through.
    $effect(() => {
        const agentId = promptSections.agentId;
        const mode = promptSections.mode;
        void agentId;
        void mode;
        // Cancel any pending debounced call — the immediate fetch supersedes it.
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        if (agentId) {
            void runPreview(false);
        }
    });

    // Effect 2: debounced re-preview on edit / toggle / save / active-section
    // change. The `activeBody` read is what actually triggers the 500ms debounce
    // while the operator types in the editor; isDirty / activeId / disabledOverrides
    // / sections.length cover the toggle + save + delete + select paths.
    $effect(() => {
        // Access all reactive fields we want to track.
        const agentId = promptSections.agentId;
        const activeBody = promptSections.activeBody;
        const activeId = promptSections.activeId;
        const isDirty = promptSections.isDirty;
        const disabledCount = promptSections.disabledOverrides.length;
        const sectionCount = promptSections.sections.length;
        void activeBody;
        void activeId;
        void isDirty;
        void disabledCount;
        void sectionCount;
        if (!agentId) return;
        schedulePreview();
    });

    // Cleanup: ensure any pending debounce timer is cleared when the component
    // unmounts (prevents a stale fetch from mutating state after navigation).
    $effect(() => {
        return () => {
            if (debounceTimer !== null) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }
            previewToken++; // invalidate any in-flight fetch
        };
    });
</script>

<div class="flex flex-col h-full">
    <div class="shrink-0 border-b border-border px-4 py-2 flex items-center gap-3">
        <PromptTopbarChip />
    </div>

    {#if !promptSections.agentId}
        <EmptyState />
    {:else}
        <div {...api.getRootProps()} class="flex-1 flex overflow-hidden">
            <div
                {...api.getPanelProps({ id: "browser" })}
                class="overflow-hidden border-r border-border"
            >
                <SectionBrowser />
            </div>
            <div
                {...api.getResizeTriggerProps({ id: "browser:editor" })}
                class="w-1 bg-border hover:bg-accent cursor-col-resize"
            ></div>
            <div
                {...api.getPanelProps({ id: "editor" })}
                class="overflow-hidden flex flex-col"
            >
                <SectionEditor />
            </div>
            <div
                {...api.getResizeTriggerProps({ id: "editor:preview" })}
                class="w-1 bg-border hover:bg-accent cursor-col-resize"
            ></div>
            <div
                {...api.getPanelProps({ id: "preview" })}
                class="overflow-hidden border-l border-border"
            >
                <PreviewPanel />
            </div>
        </div>
    {/if}
</div>
