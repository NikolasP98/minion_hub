<script lang="ts">
  import type { SectionFull } from "@minion-stack/shared";
  import { promptSections } from "$lib/state/features/prompt-sections.svelte";
  import {
    deleteSection,
    getSection,
    listSections,
    setOverrides,
    upsertSection,
  } from "$lib/services/prompt-sections-rpc";
  import { PromptSectionsError } from "$lib/services/prompt-sections-rpc";
  import { toastError, toastSuccess } from "$lib/state/ui/toast.svelte";
  import EditorMetadata from "./EditorMetadata.svelte";
  import MarkdownView from "./MarkdownView.svelte";
  import ValidationErrors from "./ValidationErrors.svelte";

  // Local $state mirror of the full section — populated on active change.
  // Editor body is bound to `promptSections.activeBody` so the preview pane
  // (wired in 20-04) can read the unsaved draft via `draftOverride`.
  let active = $state<SectionFull | null>(null);
  let loadToken = 0;
  let saving = $state(false);
  let deleting = $state(false);

  const activeId = $derived(promptSections.activeId);
  const activeMeta = $derived(
    activeId ? promptSections.sections.find((s) => s.id === activeId) ?? null : null,
  );
  const isCustom = $derived(active?.source === "custom");
  const isBuiltin = $derived(active?.source === "builtin");
  const isOverridden = $derived(
    activeId ? promptSections.disabledOverrides.includes(activeId) : false,
  );

  // Fetch full section body when activeId changes (avoids refetching if
  // `handleClick` in SectionRow already populated activeBody — we still refetch
  // the full metadata to get render + source in sync).
  $effect(() => {
    const agentId = promptSections.agentId;
    const id = activeId;
    if (!agentId || !id) {
      active = null;
      return;
    }
    const token = ++loadToken;
    (async () => {
      try {
        const full = await getSection(agentId, id);
        if (token !== loadToken) return;
        active = full;
        // Only overwrite body if the user hasn't started editing (isDirty=false)
        if (!promptSections.isDirty) {
          promptSections.activeBody = full.render;
        }
      } catch (err) {
        if (token !== loadToken) return;
        toastError("Failed to load section", (err as Error).message);
      }
    })();
  });

  function patchActive(p: Partial<SectionFull>) {
    if (!active) return;
    active = { ...active, ...p };
    promptSections.isDirty = true;
  }

  function onBodyInput(e: Event) {
    const v = (e.currentTarget as HTMLTextAreaElement).value;
    promptSections.activeBody = v;
    promptSections.isDirty = true;
  }

  async function handleSave() {
    if (!active || !promptSections.agentId || !isCustom) return;
    saving = true;
    try {
      const updated = await upsertSection(promptSections.agentId, {
        id: active.id,
        layer: active.layer,
        order: active.order,
        modes: active.modes,
        cacheable: active.cacheable,
        enabled: active.enabled,
        render: promptSections.activeBody,
      });
      // Reconcile: refresh list so new metadata lands everywhere.
      const sections = await listSections(promptSections.agentId);
      promptSections.sections = sections;
      active = { ...active, ...updated, render: promptSections.activeBody };
      promptSections.isDirty = false;
      promptSections.validationErrors = [];
      toastSuccess("Section saved", active.id);
    } catch (err) {
      if (err instanceof PromptSectionsError && err.isValidationError) {
        promptSections.validationErrors = err.violations ?? [];
      } else {
        toastError("Save failed", (err as Error).message);
      }
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    if (!active || !promptSections.agentId || !isCustom) return;
    if (!confirm(`Delete section "${active.id}"? This cannot be undone.`)) return;
    deleting = true;
    try {
      await deleteSection(promptSections.agentId, active.id);
      promptSections.sections = promptSections.sections.filter((s) => s.id !== active!.id);
      promptSections.activeId = null;
      promptSections.activeBody = "";
      promptSections.isDirty = false;
      promptSections.validationErrors = [];
      active = null;
      toastSuccess("Section deleted");
    } catch (err) {
      toastError("Delete failed", (err as Error).message);
    } finally {
      deleting = false;
    }
  }

  async function handleResetOverride() {
    const current = active;
    if (!current || !promptSections.agentId || !isBuiltin) return;
    const previous = [...promptSections.disabledOverrides];
    const next = previous.filter((id) => id !== current.id);
    promptSections.disabledOverrides = next;
    try {
      const res = await setOverrides(promptSections.agentId, next);
      promptSections.disabledOverrides = res.disabled;
      toastSuccess("Reset to default", current.id);
    } catch (err) {
      promptSections.disabledOverrides = previous;
      toastError("Reset failed", (err as Error).message);
    }
  }

  // Cmd/Ctrl+S = save (only meaningful for custom sections with unsaved edits).
  $effect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        if (isCustom && promptSections.isDirty && !saving) {
          e.preventDefault();
          void handleSave();
        }
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });
</script>

<div class="flex flex-col h-full overflow-hidden">
  {#if !activeId || !active}
    <div class="flex-1 flex items-center justify-center p-6 text-sm text-muted">
      Select a section from the browser to edit.
    </div>
  {:else}
    <!-- Header strip -->
    <div
      class="shrink-0 border-b border-border px-3 py-2 flex items-center gap-2 text-xs"
    >
      <span class="font-mono font-semibold truncate flex-1" title={active.id}>
        {active.id}
      </span>
      {#if isBuiltin}
        <span
          class="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-zinc-500/20 text-zinc-400"
          >Builtin — read only</span
        >
        {#if isOverridden}
          <button
            type="button"
            onclick={handleResetOverride}
            class="px-2 py-1 rounded border border-border bg-bg hover:bg-bg3 text-xs"
          >
            Reset to default
          </button>
        {/if}
      {:else}
        <button
          type="button"
          disabled={!promptSections.isDirty || saving}
          onclick={handleSave}
          class="px-2 py-1 rounded border border-accent bg-accent/15 text-accent text-xs disabled:opacity-40"
          title="Cmd/Ctrl+S"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={deleting}
          onclick={handleDelete}
          class="px-2 py-1 rounded border border-red-500/60 bg-red-500/10 text-red-300 text-xs disabled:opacity-40"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      {/if}
    </div>

    <!-- Body: builtin → MarkdownView (rendered output), custom → YAML textarea
         (editable). The gateway returns def.render(ctx) for builtins so we
         show the actual prompt content the model receives. -->
    <div class="flex-1 overflow-auto flex flex-col">
      {#if isBuiltin}
        <div class="p-3">
          <MarkdownView value={promptSections.activeBody} />
        </div>
      {:else}
        <textarea
          class="flex-1 w-full p-3 font-mono text-xs bg-bg text-text resize-none outline-none border-0 focus:ring-0"
          spellcheck="false"
          autocomplete="off"
          value={promptSections.activeBody}
          oninput={onBodyInput}
          placeholder="# YAML section body…"
        ></textarea>
      {/if}
    </div>

    <!-- Validation errors (inline, D-10) -->
    {#if promptSections.validationErrors.length > 0}
      <div class="shrink-0 border-t border-border max-h-40 overflow-y-auto">
        <ValidationErrors errors={promptSections.validationErrors} />
      </div>
    {/if}

    <!-- Metadata strip -->
    <EditorMetadata
      section={active}
      readonly={isBuiltin}
      onchange={patchActive}
    />
  {/if}
</div>
