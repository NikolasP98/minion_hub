<script lang="ts">
    import * as splitter from "@zag-js/splitter";
    import { normalizeProps, useMachine } from "@zag-js/svelte";
    import { promptSections } from "$lib/state/features/prompt-sections.svelte";
    import EmptyState from "./EmptyState.svelte";
    import PromptTopbarChip from "./PromptTopbarChip.svelte";
    import SectionBrowser from "./SectionBrowser.svelte";
    import SectionEditor from "./SectionEditor.svelte";
    import PreviewPanel from "./PreviewPanel.svelte";

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
