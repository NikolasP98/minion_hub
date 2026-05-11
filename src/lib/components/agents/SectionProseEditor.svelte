<script lang="ts">
  /**
   * Phase D-0f-1.5 — editor modal for externalized section prose.
   *
   * - Probes known variant suffixes (none, full, minimal) and shows existing
   *   files as sub-tabs.
   * - When a variant has no file yet but the section ships a `templateText`
   *   (Tier-1), an "Initialize from default" button seeds the textarea.
   * - Scope toggle: Global (gateway-wide default) vs Agent (per-agent
   *   override at <workspaceDir>/prompts/<id>.md). Server derives the
   *   workspace path from agentId — client never sends a path.
   */
  import {
    listSectionWorkspaceFiles,
    ProseConflictError,
    readSectionProse,
    writeSectionProse,
    type WorkspaceFileEntry,
  } from '$lib/services/gateway.svelte';

  let {
    open = $bindable(false),
    agentId,
    layer,
    sectionId,
    sectionLabel,
    mode = 'prose',
    onSaved,
  }: {
    open?: boolean;
    agentId: string;
    layer: 'platform' | 'agent-type' | 'identity' | 'user' | 'session';
    sectionId: string;
    sectionLabel: string;
    /** Phase D-0g-1: 'prose' = editor for STATIC sections (default);
     * 'fileInspector' = read-only list of workspace files embedded by
     * FILE-source sections (e.g. project-context). */
    mode?: 'prose' | 'fileInspector';
    onSaved?: () => void;
  } = $props();

  // ── Phase D-0g-1: file-inspector state ──────────────────────────────────
  let inspectorFiles = $state<WorkspaceFileEntry[]>([]);
  let inspectorLoading = $state(false);
  let inspectorError = $state<string | null>(null);
  let activeFileIdx = $state(0);

  $effect(() => {
    if (open && mode === 'fileInspector' && agentId) {
      void loadInspector();
    } else if (!open) {
      inspectorFiles = [];
      activeFileIdx = 0;
      inspectorError = null;
    }
  });

  async function loadInspector() {
    inspectorLoading = true;
    inspectorError = null;
    try {
      inspectorFiles = await listSectionWorkspaceFiles(agentId);
      activeFileIdx = 0;
    } catch (err) {
      inspectorError = err instanceof Error ? err.message : String(err);
    } finally {
      inspectorLoading = false;
    }
  }

  const CANDIDATE_VARIANTS: (string | undefined)[] = [undefined, 'full', 'minimal'];

  type Slot = {
    variant: string | undefined;
    path: string;
    content: string;
    exists: boolean;
    dirty: string | null;
    templateDefault?: string;
    /** D-0g-2: mtime from the read response, sent back as expectedMtimeMs
     * on the next write so we detect concurrent edits. 0 if file didn't
     * exist when read (= "must still not exist" assertion). */
    mtimeMs?: number;
  };

  /** D-0g-2: present after a write returns CONFLICT. Holds the live
   * server-side content so the user can compare/discard. */
  type ConflictInfo = {
    actualContent: string;
    actualMtimeMs: number;
  };

  let scope = $state<'global' | 'agent'>('global');
  let slots = $state<Slot[]>([]);
  let activeIdx = $state(0);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let conflict = $state<ConflictInfo | null>(null);

  $effect(() => {
    if (open && sectionId) {
      void loadAll();
    } else if (!open) {
      slots = [];
      activeIdx = 0;
      error = null;
      scope = 'global';
    }
  });

  // Re-fetch when scope changes (but only while open).
  $effect(() => {
    const _trigger = scope;
    if (open && sectionId) void loadAll();
  });

  async function loadAll() {
    loading = true;
    error = null;
    try {
      const results = await Promise.all(
        CANDIDATE_VARIANTS.map((variant) =>
          readSectionProse({
            layer,
            sectionId,
            variant,
            scope,
            agentId: scope === 'agent' ? agentId : undefined,
          }).then(
            (r) => ({ variant, ...r }),
            (err) => ({ variant, error: err }),
          ),
        ),
      );
      // Keep every slot that either has content or has a templateDefault available.
      // That way the modal shows variants the user can initialize.
      type ReadOk = {
        variant: string | undefined;
        path: string;
        content: string;
        exists: boolean;
        scope: 'global' | 'agent';
        templateDefault?: string;
        mtimeMs?: number;
      };
      slots = results
        .filter((r): r is ReadOk =>
          'exists' in r && (r.exists || typeof r.templateDefault === 'string'),
        )
        .map((r) => ({
          variant: r.variant,
          path: r.path,
          content: r.content,
          exists: r.exists,
          dirty: null,
          templateDefault: r.templateDefault,
          mtimeMs: r.mtimeMs,
        }));
      activeIdx = 0;
      conflict = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function save() {
    const slot = slots[activeIdx];
    if (!slot || slot.dirty === null) return;
    saving = true;
    error = null;
    conflict = null;
    try {
      // D-0g-2: send expectedMtimeMs so a concurrent edit from another
      // operator (or external fs edit) is rejected with CONFLICT.
      // mtimeMs from read: number = "file matches", 0 = "must not exist"
      // (new files), undefined = no concurrency check.
      const expectedMtimeMs = slot.exists ? slot.mtimeMs ?? undefined : 0;
      const res = await writeSectionProse({
        layer,
        sectionId,
        variant: slot.variant,
        scope,
        agentId: scope === 'agent' ? agentId : undefined,
        content: slot.dirty,
        expectedMtimeMs,
      });
      slot.content = slot.dirty;
      slot.exists = true;
      slot.dirty = null;
      slot.mtimeMs = res.mtimeMs;
      onSaved?.();
    } catch (err) {
      if (err instanceof ProseConflictError) {
        // Fetch the live content so the user can see what diverged.
        try {
          const fresh = await readSectionProse({
            layer,
            sectionId,
            variant: slot.variant,
            scope,
            agentId: scope === 'agent' ? agentId : undefined,
          });
          conflict = {
            actualContent: fresh.content,
            actualMtimeMs: fresh.mtimeMs ?? 0,
          };
        } catch {
          conflict = { actualContent: '(failed to fetch)', actualMtimeMs: err.actualMtimeMs ?? 0 };
        }
      } else {
        error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      saving = false;
    }
  }

  /** D-0g-2: discard local edits and adopt the server-side content. */
  function resolveConflictDiscardMine() {
    const slot = slots[activeIdx];
    if (!slot || !conflict) return;
    slot.content = conflict.actualContent;
    slot.mtimeMs = conflict.actualMtimeMs;
    slot.dirty = null;
    slot.exists = true;
    conflict = null;
  }

  /** D-0g-2: keep local edits but acknowledge the new server mtime so the
   *  next save overwrites. (Last-write-wins after explicit acknowledgement.) */
  function resolveConflictOverwrite() {
    const slot = slots[activeIdx];
    if (!slot || !conflict) return;
    slot.mtimeMs = conflict.actualMtimeMs;
    conflict = null;
  }

  function initFromDefault() {
    const slot = slots[activeIdx];
    if (!slot?.templateDefault) return;
    slot.dirty = slot.templateDefault;
  }

  function onInput(e: Event) {
    const slot = slots[activeIdx];
    if (!slot) return;
    slot.dirty = (e.target as HTMLTextAreaElement).value;
  }

  function close() {
    open = false;
  }

  function variantLabel(v: string | undefined): string {
    return v ?? 'default';
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="presentation"
    onclick={close}
    onkeydown={(e) => {
      if (e.key === 'Escape') close();
    }}
  >
    <div
      class="bg-bg1 border border-border rounded-lg shadow-2xl w-[min(80vw,800px)] max-h-[80vh] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prose-editor-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 id="prose-editor-title" class="text-sm font-semibold text-foreground">
            {mode === 'fileInspector' ? 'Workspace files' : 'Edit prose'} — {sectionLabel}
          </h2>
          <p class="text-[10px] text-muted mt-0.5 font-mono truncate">
            {mode === 'fileInspector' ? 'read-only' : scope} · {layer}/{sectionId}
          </p>
        </div>
        <!-- Scope toggle (prose mode only) -->
        {#if mode === 'prose'}
          <div class="flex items-center gap-0.5 bg-bg2 rounded p-0.5 shrink-0">
            <button
              type="button"
              class="text-[10px] px-2 py-1 rounded transition-colors"
              class:bg-bg1={scope === 'global'}
              class:text-foreground={scope === 'global'}
              class:text-muted={scope !== 'global'}
              onclick={() => (scope = 'global')}
              disabled={saving}
            >
              Global
            </button>
            <button
              type="button"
              class="text-[10px] px-2 py-1 rounded transition-colors"
              class:bg-bg1={scope === 'agent'}
              class:text-foreground={scope === 'agent'}
              class:text-muted={scope !== 'agent'}
              onclick={() => (scope = 'agent')}
              disabled={saving}
              title="Per-agent override at <workspaceDir>/prompts/"
            >
              Agent
            </button>
          </div>
        {/if}
        <button
          type="button"
          class="text-muted hover:text-foreground transition-colors shrink-0"
          onclick={close}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <!-- Variant tabs (only if >1, prose mode only) -->
      {#if mode === 'prose' && slots.length > 1}
        <div class="px-4 pt-2 flex gap-1 border-b border-border/30">
          {#each slots as slot, i}
            <button
              type="button"
              class="text-[11px] px-2 py-1 rounded-t border-b-2 transition-colors"
              class:border-accent={activeIdx === i}
              class:text-foreground={activeIdx === i}
              class:border-transparent={activeIdx !== i}
              class:text-muted={activeIdx !== i}
              onclick={() => (activeIdx = i)}
            >
              {variantLabel(slot.variant)}
              {#if !slot.exists}
                <span class="text-muted/60" title="Not yet initialized">○</span>
              {/if}
              {#if slot.dirty !== null}
                <span class="text-accent">•</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}

      <!-- Body -->
      <div class="flex-1 overflow-auto px-4 py-3">
        {#if mode === 'fileInspector'}
          {#if inspectorLoading}
            <p class="text-muted text-xs">Loading workspace files…</p>
          {:else if inspectorError}
            <p class="text-red-400 text-xs font-mono">{inspectorError}</p>
          {:else if inspectorFiles.length === 0}
            <p class="text-muted text-xs">No workspace files embedded by this section.</p>
          {:else}
            <p class="text-[10px] text-muted mb-3">
              These files are embedded verbatim into the prompt by this section. To edit
              them, use your agent's file tools or workspace editor — they're agent-owned
              content, not prompt-template prose.
            </p>
            <!-- File list -->
            <div class="space-y-1 mb-3">
              {#each inspectorFiles as file, i}
                <button
                  type="button"
                  class="w-full text-left px-2 py-1.5 rounded border transition-colors flex items-center justify-between gap-2"
                  class:border-accent={activeFileIdx === i}
                  class:bg-bg2={activeFileIdx === i}
                  class:border-border={activeFileIdx !== i}
                  class:hover:bg-bg2={activeFileIdx !== i}
                  onclick={() => (activeFileIdx = i)}
                >
                  <span class="text-[11px] font-mono text-foreground truncate flex-1">
                    {file.path}
                  </span>
                  <span class="text-[9px] text-muted font-mono shrink-0">
                    {file.chars.toLocaleString()} chars
                  </span>
                  {#if !file.exists && !file.synthetic}
                    <span class="text-[9px] text-red-400 font-mono shrink-0" title="File not found on disk">missing</span>
                  {/if}
                  {#if file.synthetic}
                    <span class="text-[9px] text-amber-400 font-mono shrink-0" title="Synthetic entry (e.g. onboarding gate)">synthetic</span>
                  {/if}
                </button>
              {/each}
            </div>
            <!-- Preview pane -->
            {@const active = inspectorFiles[activeFileIdx]}
            {#if active}
              <div class="border border-border/50 rounded">
                <div class="px-3 py-1.5 border-b border-border/30 text-[9px] font-mono text-muted">
                  Preview · {active.path}
                </div>
                <pre
                  class="px-3 py-2 text-[11px] font-mono text-foreground whitespace-pre-wrap break-words max-h-[40vh] overflow-auto"
                >{active.truncatedPreview}</pre>
              </div>
            {/if}
          {/if}
        {:else if loading}
          <p class="text-muted text-xs">Loading…</p>
        {:else if error}
          <p class="text-red-400 text-xs font-mono">{error}</p>
        {:else if conflict}
          <!-- D-0g-2: write conflict resolution UI -->
          <div class="space-y-3">
            <div class="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2">
              <p class="text-amber-300 text-xs font-semibold">File changed since you opened it</p>
              <p class="text-amber-200/80 text-[11px] mt-1">
                Another save (from another operator or external edit) landed before yours.
                Your unsaved edits are preserved — choose how to proceed.
              </p>
            </div>
            <div>
              <p class="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">
                Current server content
              </p>
              <pre
                class="px-3 py-2 text-[11px] font-mono text-foreground whitespace-pre-wrap break-words max-h-[25vh] overflow-auto bg-bg2 border border-border/50 rounded"
              >{conflict.actualContent}</pre>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                class="text-[11px] px-2.5 py-1 rounded border border-border text-muted hover:text-foreground transition-colors"
                onclick={resolveConflictDiscardMine}
              >
                Discard my changes
              </button>
              <button
                type="button"
                class="text-[11px] px-2.5 py-1 rounded border border-amber-500/50 text-amber-300 hover:bg-amber-500/10 transition-colors"
                onclick={resolveConflictOverwrite}
              >
                Keep my changes (overwrite on next save)
              </button>
            </div>
          </div>
        {:else if slots.length === 0}
          <div class="space-y-2">
            <p class="text-muted text-xs">
              This section hasn't been migrated to editable prose yet.
            </p>
            <p class="text-muted/70 text-[10px]">
              Pure-prose sections will become editable in the D-0f-2 sweep. Sections with
              conditional rendering logic (e.g. tool-availability branches) stay rendered
              at runtime.
            </p>
          </div>
        {:else}
          {@const slot = slots[activeIdx]}
          <p class="text-[10px] text-muted mb-2 font-mono break-all">{slot.path}</p>
          {#if !slot.exists && slot.dirty === null}
            <div class="space-y-2 mb-3">
              <p class="text-muted text-xs">
                No file yet. {slot.templateDefault
                  ? 'Initialize from the section default to start editing.'
                  : 'This variant has no default template — type below to create one.'}
              </p>
              {#if slot.templateDefault}
                <button
                  type="button"
                  class="text-[11px] px-2.5 py-1 rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
                  onclick={initFromDefault}
                >
                  Initialize from default
                </button>
              {/if}
            </div>
          {/if}
          <textarea
            class="w-full h-[40vh] bg-bg2 border border-border/50 rounded px-3 py-2 text-xs font-mono text-foreground resize-none focus:outline-none focus:border-accent"
            value={slot.dirty ?? slot.content}
            placeholder={slot.templateDefault && !slot.exists ? slot.templateDefault : ''}
            oninput={onInput}
          ></textarea>
        {/if}
      </div>

      <!-- Footer -->
      <div class="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
        <button
          type="button"
          class="text-xs px-3 py-1.5 rounded border border-border text-muted hover:text-foreground transition-colors"
          onclick={close}
          disabled={saving}
        >
          {mode === 'fileInspector' ? 'Close' : 'Cancel'}
        </button>
        {#if mode === 'prose'}
          <button
            type="button"
            class="text-xs px-3 py-1.5 rounded bg-accent text-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            onclick={save}
            disabled={
              saving ||
              loading ||
              slots.length === 0 ||
              slots[activeIdx]?.dirty === null
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
