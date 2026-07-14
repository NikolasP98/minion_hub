<script lang="ts">
  import { Button } from '$lib/components/ui';
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
  import * as m from '$lib/paraglide/messages';
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
    /** D-0g-3: surface from gateway; true means edits invalidate the
     * Anthropic prompt-cache prefix on this section's next render. */
    cacheable?: boolean;
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
        cacheable?: boolean;
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
          cacheable: r.cacheable,
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
    return v ?? m.prose_variantDefault();
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-canvas)_60%,transparent)] backdrop-blur-sm"
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
            {mode === 'fileInspector' ? m.prose_workspaceFiles() : m.prose_editProse()} — {sectionLabel}
          </h2>
          <p class="text-[length:var(--font-size-telemetry)] text-muted mt-0.5 font-mono truncate">
            {mode === 'fileInspector' ? m.prose_readOnly() : scope} · {layer}/{sectionId}
          </p>
        </div>
        <!-- Scope toggle (prose mode only) -->
        {#if mode === 'prose'}
          <div class="flex items-center gap-0.5 bg-bg2 rounded p-0.5 shrink-0">
            <Button variant="ghost"
              type="button"
              class={`text-[length:var(--font-size-telemetry)] px-2 py-1 rounded transition-colors ${scope === 'global' ? 'bg-bg1 text-foreground' : 'text-muted'}`}
              onclick={() => (scope = 'global')}
              disabled={saving}
            >
              {m.prose_global()}
            </Button>
            <Button variant="ghost"
              type="button"
              class={`text-[length:var(--font-size-telemetry)] px-2 py-1 rounded transition-colors ${scope === 'agent' ? 'bg-bg1 text-foreground' : 'text-muted'}`}
              onclick={() => (scope = 'agent')}
              disabled={saving}
              title={m.prose_agentOverrideTitle()}
            >
              {m.prose_agent()}
            </Button>
          </div>
        {/if}
        <Button variant="ghost"
          type="button"
          class="text-muted hover:text-foreground transition-colors shrink-0"
          onclick={close}
          aria-label={m.common_close()}
        >
          ✕
        </Button>
      </div>

      <!-- Variant tabs (only if >1, prose mode only) -->
      {#if mode === 'prose' && slots.length > 1}
        <div class="px-4 pt-2 flex gap-1 border-b border-border/30">
          {#each slots as slot, i}
            <Button variant="ghost"
              type="button"
              class={`text-[length:var(--font-size-caption)] px-2 py-1 rounded-t border-b-2 transition-colors ${activeIdx === i ? 'border-accent text-foreground' : 'border-transparent text-muted'}`}
              onclick={() => (activeIdx = i)}
            >
              {variantLabel(slot.variant)}
              {#if !slot.exists}
                <span class="text-muted-strong" title={m.prose_notYetInitialized()}>○</span>
              {/if}
              {#if slot.dirty !== null}
                <span class="text-accent">•</span>
              {/if}
            </Button>
          {/each}
        </div>
      {/if}

      <!-- Body -->
      <div class="flex-1 overflow-auto px-4 py-3">
        {#if mode === 'fileInspector'}
          {#if inspectorLoading}
            <p class="text-muted text-xs">{m.prose_loadingWorkspaceFiles()}</p>
          {:else if inspectorError}
            <p class="text-[var(--color-danger-fg)] text-xs font-mono">{inspectorError}</p>
          {:else if inspectorFiles.length === 0}
            <p class="text-muted text-xs">{m.prose_noWorkspaceFiles()}</p>
          {:else}
            <p class="text-[length:var(--font-size-telemetry)] text-muted mb-3">
              {m.prose_workspaceFilesInfo()}
            </p>
            <!-- File list -->
            <div class="space-y-1 mb-3">
              {#each inspectorFiles as file, i}
                <Button variant="ghost"
                  type="button"
                  class={`w-full text-left px-2 py-1.5 rounded border transition-colors flex items-center justify-between gap-2 ${activeFileIdx === i ? 'border-accent bg-bg2' : 'border-border hover:bg-bg2'}`}
                  onclick={() => (activeFileIdx = i)}
                >
                  <span class="text-[length:var(--font-size-caption)] font-mono text-foreground truncate flex-1">
                    {file.path}
                  </span>
                  <span class="text-[length:var(--font-size-telemetry)] text-muted font-mono shrink-0">
                    {file.chars.toLocaleString()} chars
                  </span>
                  {#if !file.exists && !file.synthetic}
                    <span class="text-[length:var(--font-size-telemetry)] text-[var(--color-danger-fg)] font-mono shrink-0" title={m.prose_fileNotFound()}>{m.prose_missing()}</span>
                  {/if}
                  {#if file.synthetic}
                    <span class="text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)] font-mono shrink-0" title={m.prose_syntheticEntry()}>{m.prose_synthetic()}</span>
                  {/if}
                </Button>
              {/each}
            </div>
            <!-- Preview pane -->
            {@const active = inspectorFiles[activeFileIdx]}
            {#if active}
              <div class="border border-border/50 rounded">
                <div class="px-3 py-1.5 border-b border-border/30 text-[length:var(--font-size-telemetry)] font-mono text-muted">
                  {m.prose_preview()} · {active.path}
                </div>
                <pre
                  class="px-3 py-2 text-[length:var(--font-size-caption)] font-mono text-foreground whitespace-pre-wrap break-words max-h-[40vh] overflow-auto"
                >{active.truncatedPreview}</pre>
              </div>
            {/if}
          {/if}
        {:else if loading}
          <p class="text-muted text-xs">{m.common_loading()}…</p>
        {:else if error}
          <p class="text-[var(--color-danger-fg)] text-xs font-mono">{error}</p>
        {:else if conflict}
          <!-- D-0g-2: write conflict resolution UI -->
          <div class="space-y-3">
            <div class="rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-surface)] px-3 py-2">
              <p class="text-[var(--color-warning-fg)] text-xs font-semibold">{m.prose_fileChangedTitle()}</p>
              <p class="text-[var(--color-warning-fg)] text-[length:var(--font-size-caption)] mt-1">
                {m.prose_fileChangedDesc()}
              </p>
            </div>
            <div>
              <p class="text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide text-muted mb-1">
                {m.prose_currentServerContent()}
              </p>
              <pre
                class="px-3 py-2 text-[length:var(--font-size-caption)] font-mono text-foreground whitespace-pre-wrap break-words max-h-[25vh] overflow-auto bg-bg2 border border-border/50 rounded"
              >{conflict.actualContent}</pre>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <Button variant="ghost"
                type="button"
                class="text-[length:var(--font-size-caption)] px-2.5 py-1 rounded border border-border text-muted hover:text-foreground transition-colors"
                onclick={resolveConflictDiscardMine}
              >
                {m.prose_discardMyChanges()}
              </Button>
              <Button variant="ghost"
                type="button"
                class="text-[length:var(--font-size-caption)] px-2.5 py-1 rounded border border-[var(--color-warning-border)] text-[var(--color-warning-fg)] hover:bg-[var(--color-warning-surface)] transition-colors"
                onclick={resolveConflictOverwrite}
              >
                {m.prose_keepMyChanges()}
              </Button>
            </div>
          </div>
        {:else if slots.length === 0}
          <div class="space-y-2">
            <p class="text-muted text-xs">
              {m.prose_notMigrated()}
            </p>
            <p class="text-muted-strong text-[length:var(--font-size-telemetry)]">
              {m.prose_migrationNote()}
            </p>
          </div>
        {:else}
          {@const slot = slots[activeIdx]}
          <p class="text-[length:var(--font-size-telemetry)] text-muted mb-2 font-mono break-all">{slot.path}</p>
          <!-- D-0g-3: prompt-cache warning. Only render when there are unsaved
               changes — otherwise it's just noise. -->
          {#if slot.cacheable && slot.dirty !== null}
            <div
              class="mb-3 rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-surface)] px-3 py-2 flex items-start gap-2"
            >
              <span class="text-[var(--color-warning-fg)] text-[length:var(--font-size-body)] leading-none mt-0.5">⚠</span>
              <div class="flex-1 min-w-0">
                <p class="text-[var(--color-warning-fg)] text-[length:var(--font-size-caption)] font-semibold">
                  Cacheable section
                </p>
                <p class="text-[var(--color-warning-fg)] text-[length:var(--font-size-telemetry)] mt-0.5">
                  Editing this section invalidates the Anthropic prompt-cache prefix on
                  the agent's next call. Small but real cost on long contexts.
                </p>
              </div>
            </div>
          {/if}
          {#if !slot.exists && slot.dirty === null}
            <div class="space-y-2 mb-3">
              <p class="text-muted text-xs">
                {slot.templateDefault
                  ? m.prose_initFromDefault()
                  : m.prose_noDefaultTemplate()}
              </p>
              {#if slot.templateDefault}
                <Button variant="ghost"
                  type="button"
                  class="text-[length:var(--font-size-caption)] px-2.5 py-1 rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
                  onclick={initFromDefault}
                >
                  {m.prose_initializeButton()}
                </Button>
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
        <Button variant="ghost"
          type="button"
          class="text-xs px-3 py-1.5 rounded border border-border text-muted hover:text-foreground transition-colors"
          onclick={close}
          disabled={saving}
        >
          {mode === 'fileInspector' ? m.common_close() : m.common_cancel()}
        </Button>
        {#if mode === 'prose'}
          <Button variant="ghost"
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
            {saving ? m.prose_saving() : m.common_save()}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}
