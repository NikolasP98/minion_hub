<script lang="ts">
  /**
   * Phase D-0f-1 — editor modal for externalized static section prose.
   *
   * Reads/writes via prompt.sections.prose.read|write RPCs. Tries known variant
   * names (none, full, minimal) and shows the ones that exist as sub-tabs.
   * Global scope only in the pilot; per-agent override comes in D-0f-2.
   */
  import { readSectionProse, writeSectionProse } from '$lib/services/gateway.svelte';

  let {
    open = $bindable(false),
    layer,
    sectionId,
    sectionLabel,
    onSaved,
  }: {
    open?: boolean;
    layer: 'platform' | 'agent-type' | 'identity' | 'user' | 'session';
    sectionId: string;
    sectionLabel: string;
    onSaved?: () => void;
  } = $props();

  // Variants we'll probe. Section files use these suffixes today.
  const CANDIDATE_VARIANTS: (string | undefined)[] = [undefined, 'full', 'minimal'];

  type Slot = {
    variant: string | undefined;
    path: string;
    content: string;
    exists: boolean;
    dirty: string | null; // user-edited content, null if pristine
  };

  let slots = $state<Slot[]>([]);
  let activeIdx = $state(0);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (open && sectionId) {
      void loadAll();
    } else if (!open) {
      // Reset on close so reopen always re-fetches.
      slots = [];
      activeIdx = 0;
      error = null;
    }
  });

  async function loadAll() {
    loading = true;
    error = null;
    try {
      const results = await Promise.all(
        CANDIDATE_VARIANTS.map((variant) =>
          readSectionProse({ layer, sectionId, variant, scope: 'global' }).then(
            (r) => ({ variant, ...r }),
            (err) => ({ variant, error: err }),
          ),
        ),
      );
      slots = results
        .filter((r): r is { variant: string | undefined; path: string; content: string; exists: boolean; scope: 'global' | 'agent' } => 'exists' in r && r.exists)
        .map((r) => ({
          variant: r.variant,
          path: r.path,
          content: r.content,
          exists: r.exists,
          dirty: null,
        }));
      activeIdx = 0;
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
    try {
      await writeSectionProse({
        layer,
        sectionId,
        variant: slot.variant,
        scope: 'global',
        content: slot.dirty,
      });
      slot.content = slot.dirty;
      slot.dirty = null;
      onSaved?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
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
      <div class="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h2 id="prose-editor-title" class="text-sm font-semibold text-foreground">
            Edit prose — {sectionLabel}
          </h2>
          <p class="text-[10px] text-muted mt-0.5 font-mono">
            global · {layer}/{sectionId}
          </p>
        </div>
        <button
          type="button"
          class="text-muted hover:text-foreground transition-colors"
          onclick={close}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <!-- Variant tabs (only if >1) -->
      {#if slots.length > 1}
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
              {#if slot.dirty !== null}
                <span class="text-accent">•</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}

      <!-- Body -->
      <div class="flex-1 overflow-auto px-4 py-3">
        {#if loading}
          <p class="text-muted text-xs">Loading…</p>
        {:else if error}
          <p class="text-red-400 text-xs font-mono">{error}</p>
        {:else if slots.length === 0}
          <p class="text-muted text-xs">No prose files found for this section.</p>
        {:else}
          {@const slot = slots[activeIdx]}
          <p class="text-[10px] text-muted mb-2 font-mono break-all">{slot.path}</p>
          <textarea
            class="w-full h-[40vh] bg-bg2 border border-border/50 rounded px-3 py-2 text-xs font-mono text-foreground resize-none focus:outline-none focus:border-accent"
            value={slot.dirty ?? slot.content}
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
          Cancel
        </button>
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
      </div>
    </div>
  </div>
{/if}
