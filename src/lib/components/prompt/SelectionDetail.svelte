<script lang="ts">
  import * as m from "$lib/paraglide/messages";
  import type { SectionFull, SectionMeta } from "@minion-stack/shared";
  import { promptSections, clearSelection } from "$lib/state/features/prompt-sections.svelte";
  import { colorForLayer } from "$lib/utils/layer-colors";
  import { formatBytes } from "$lib/utils/format";
  import {
    deleteSection, getSection, listSections, setOverrides, upsertSection,
    PromptSectionsError,
  } from "$lib/services/prompt-sections-rpc";
  import { toastError, toastSuccess } from "$lib/state/ui/toast.svelte";
  import { createHotkey } from "$lib/hotkeys";
  import MarkdownView from "./MarkdownView.svelte";
  import ValidationErrors from "./ValidationErrors.svelte";
  import AgentAvatarStack from "./AgentAvatarStack.svelte";

  const selected = $derived(promptSections.selectedIds);
  const breakdown = $derived(promptSections.preview?.breakdown ?? []);

  // Materialize the selected rows in selection order, merging breakdown bytes
  // with section metadata.
  const items = $derived.by(() => {
    const rows = breakdown;
    const map = new Map(rows.map((r) => [r.id, r]));
    const sectionMap = new Map(promptSections.sections.map((s) => [s.id, s]));
    // Iterate the breakdown (i.e. the assembled-prompt order) and keep only
    // selected ids — gives the same vertical sequence as the middle pane,
    // independent of click order.
    return rows
      .filter((r) => selected.has(r.id))
      .map((row) => {
        const meta = sectionMap.get(row.id);
        return meta ? { row, meta } : null;
      })
      .filter((x): x is { row: typeof rows[number]; meta: SectionMeta } => x !== null);
  });

  // Single-edit affordances: when exactly one custom section is selected, fetch
  // its full body so the operator can edit inline (Save / Delete buttons).
  let editorActive = $state<SectionFull | null>(null);
  let saving = $state(false);
  let deleting = $state(false);
  let loadToken = 0;

  $effect(() => {
    const ids = selected;
    const agentId = promptSections.agentId;
    const sole = ids.size === 1 ? [...ids][0] : null;
    if (!agentId || !sole) {
      editorActive = null;
      return;
    }
    const meta = promptSections.sections.find((s) => s.id === sole);
    if (!meta || meta.source !== "custom") {
      editorActive = null;
      return;
    }
    const token = ++loadToken;
    (async () => {
      try {
        const full = await getSection(agentId, sole);
        if (token !== loadToken) return;
        editorActive = full;
        if (!promptSections.isDirty) promptSections.activeBody = full.render;
      } catch (err) {
        if (token !== loadToken) return;
        toastError("Failed to load section", (err as Error).message);
      }
    })();
  });

  function onBodyInput(e: Event) {
    promptSections.activeBody = (e.currentTarget as HTMLTextAreaElement).value;
    promptSections.isDirty = true;
  }

  async function handleSave() {
    if (!editorActive || !promptSections.agentId) return;
    saving = true;
    try {
      const updated = await upsertSection(promptSections.agentId, {
        id: editorActive.id,
        layer: editorActive.layer,
        order: editorActive.order,
        modes: editorActive.modes,
        cacheable: editorActive.cacheable,
        enabled: editorActive.enabled,
        render: promptSections.activeBody,
      });
      const sections = await listSections(promptSections.agentId);
      promptSections.sections = sections;
      editorActive = { ...editorActive, ...updated, render: promptSections.activeBody };
      promptSections.isDirty = false;
      promptSections.validationErrors = [];
      toastSuccess("Section saved", editorActive.id);
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
    if (!editorActive || !promptSections.agentId) return;
    if (!confirm(m.sel_deleteConfirm({ id: editorActive.id }))) return;
    deleting = true;
    try {
      await deleteSection(promptSections.agentId, editorActive.id);
      promptSections.sections = promptSections.sections.filter((s) => s.id !== editorActive!.id);
      clearSelection();
      editorActive = null;
      toastSuccess("Section deleted");
    } catch (err) {
      toastError("Delete failed", (err as Error).message);
    } finally {
      deleting = false;
    }
  }

  async function handleResetOverride(id: string) {
    if (!promptSections.agentId) return;
    const previous = [...promptSections.disabledOverrides];
    const next = previous.filter((x) => x !== id);
    promptSections.disabledOverrides = next;
    try {
      const res = await setOverrides(promptSections.agentId, next);
      promptSections.disabledOverrides = res.disabled;
      toastSuccess("Reset to default", id);
    } catch (err) {
      promptSections.disabledOverrides = previous;
      toastError("Reset failed", (err as Error).message);
    }
  }

  // Cmd/Ctrl+S for inline save.
  createHotkey('Mod+S', () => {
    if (editorActive && promptSections.isDirty && !saving) void handleSave();
  }, { meta: { name: m.shortcuts_saveSectionName(), description: m.shortcuts_saveSectionDesc() } });

  const isSingleCustom = $derived(editorActive !== null);
</script>

<div class="flex flex-col h-full overflow-hidden">
  <div class="shrink-0 border-b border-border px-3 py-2 flex items-center justify-between text-xs">
    <span class="uppercase tracking-wider text-muted font-medium">
      {#if selected.size === 0}
        {m.sel_selection()}
      {:else if selected.size === 1}
        {m.sel_section()} · {[...selected][0]}
      {:else}
        {m.sel_selection()} · {selected.size} {m.sel_sections()}
      {/if}
    </span>
    {#if selected.size > 0}
      <button
        type="button"
        class="text-[10px] text-muted hover:text-fg transition-colors"
        onclick={clearSelection}
      >
        {m.sel_clear()}
      </button>
    {/if}
  </div>

  {#if selected.size === 0}
    <div class="flex-1 flex items-center justify-center text-xs text-muted px-4 text-center">
      {m.sel_tickSections()}
    </div>
  {:else if isSingleCustom && editorActive}
    {@const color = colorForLayer(editorActive.layer)}
    <div class="flex-1 flex flex-col overflow-hidden">
      <div class="shrink-0 px-3 py-2 border-b border-border flex flex-wrap items-center gap-2 text-[10px]">
        <span class="w-1.5 h-1.5 rounded-full {color.dot}"></span>
        <span class="font-mono text-fg/80">{editorActive.id}</span>
        <span class="px-1.5 py-0.5 rounded uppercase tracking-wider {color.badge}">
          {editorActive.layer}
        </span>
        <span class="text-muted">order {editorActive.order}</span>
        <span class="text-muted">modes {editorActive.modes.join("/")}</span>
        {#if editorActive.cacheable}<span class="text-warning">⚡ cacheable</span>{/if}
        <span class="flex-1"></span>
        <button
          type="button"
          disabled={!promptSections.isDirty || saving}
          onclick={handleSave}
          class="px-2 py-0.5 rounded border border-accent bg-accent/15 text-accent text-[10px] disabled:opacity-40"
          title={m.sel_saveHint()}
        >
          {saving ? m.sel_saving() : m.common_save()}
        </button>
        <button
          type="button"
          disabled={deleting}
          onclick={handleDelete}
          class="px-2 py-0.5 rounded border border-destructive/60 bg-destructive/10 text-destructive text-[10px] disabled:opacity-40"
        >
          {deleting ? m.sel_deleting() : m.common_delete()}
        </button>
      </div>
      <textarea
        class="flex-1 w-full p-3 font-mono text-xs bg-bg text-text resize-none outline-none border-0 focus:ring-0"
        spellcheck="false"
        autocomplete="off"
        value={promptSections.activeBody}
        oninput={onBodyInput}
      ></textarea>
      {#if promptSections.validationErrors.length > 0}
        <div class="shrink-0 border-t border-border max-h-32 overflow-y-auto">
          <ValidationErrors errors={promptSections.validationErrors} />
        </div>
      {/if}
    </div>
  {:else}
    <!-- Read-only view: 1 builtin OR multi-selection. Stack of cards, each
         section gets a metadata header + rendered body, separated by a
         terminal-rule divider. -->
    <div class="flex-1 overflow-y-auto">
      {#each items as { row, meta }, i (meta.id)}
        {@const color = colorForLayer(row.layer)}
        {#if i > 0}
          <div class="border-t border-dashed border-border/50 my-1 mx-3"></div>
        {/if}
        <article class="px-3 py-2">
          <header class="flex flex-wrap items-center gap-2 text-[10px] mb-2">
            <span class="w-1.5 h-1.5 rounded-full {color.dot}"></span>
            <span class="font-mono text-fg/80">{meta.id}</span>
            <span class="px-1.5 py-0.5 rounded uppercase tracking-wider {color.badge}">
              {row.layer}
            </span>
            <span class="text-muted">order {meta.order}</span>
            <span class="text-muted font-mono tabular-nums">{formatBytes(row.bytes)}</span>
            <span class="text-muted-strong">·</span>
            <span class="text-muted font-mono tabular-nums">{row.tokens.toLocaleString("en-US")} tok</span>
            {#if row.cacheable}<span class="text-warning" title={m.sel_cacheable()}>⚡</span>{/if}
            <span class="ml-2">
              <AgentAvatarStack
                agents={promptSections.usage[meta.id] ?? []}
                max={6}
                size={18}
              />
            </span>
            {#if meta.source === "builtin"}
              <span class="text-zinc-400">{m.sel_builtin()}</span>
              {#if promptSections.disabledOverrides.includes(meta.id)}
                <button
                  type="button"
                  class="ml-auto px-2 py-0.5 rounded border border-border text-[10px] hover:bg-bg2"
                  onclick={() => handleResetOverride(meta.id)}
                >
                  {m.sel_resetOverride()}
                </button>
              {/if}
            {:else}
              <span class="text-rose-300">{m.sel_custom()}</span>
            {/if}
          </header>
          {#if row.rendered}
            <MarkdownView value={row.rendered} />
          {:else}
            <pre class="text-xs font-mono whitespace-pre-wrap break-words text-fg/60">{`# ${meta.id} (no content)`}</pre>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</div>
