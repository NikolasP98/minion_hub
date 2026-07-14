<script lang="ts">
  import { Button } from '$lib/components/ui';

  import { slide } from 'svelte/transition';
  import * as m from '$lib/paraglide/messages';
  import {
    addBlock,
    removeBlock,
    moveBlock,
    setBlockTitle,
    type AgentNote,
  } from '$lib/state/features/agent-notes.svelte';
  import type { EaselBlock, TextBlock, TodoBlock } from '$lib/types/notes';
  import {
    getProposal,
    applyProposal,
    clearProposal,
  } from '$lib/state/features/note-polish.svelte';
  import { wordDiff } from '$lib/utils/word-diff';
  import NoteEditor from './NoteEditor.svelte';
  import TodoChecklist from './TodoChecklist.svelte';
  import {
    ListTodo,
    LayoutDashboard,
    Trash2,
    ChevronUp,
    ChevronDown,
    Image as ImageIcon,
    Loader2,
    Wand2,
    Check,
    X,
  } from 'lucide-svelte';

  let {
    note,
    compact = false,
    onopeneasel,
  }: {
    note: AgentNote;
    /** Compact (panel) vs roomy (zen) rendering of text blocks. */
    compact?: boolean;
    /** Open an easel block fullscreen. */
    onopeneasel?: (block: EaselBlock) => void;
  } = $props();

  // Per-text-block editor instances; external transcription controls (panel
  // footer / zen header) feed the focused one.
  type EditorRef = {
    handleFinal: (t: string) => void;
    handleInterim: (t: string) => void;
    polishPending: () => void;
    discardPending: () => void;
    hasPending: () => boolean;
  };
  const editors = $state<Record<string, EditorRef | undefined>>({});
  let focusedTextId = $state<string | null>(null);

  function targetEditor(): EditorRef | undefined {
    const id =
      (focusedTextId && editors[focusedTextId] && focusedTextId) ||
      note.blocks.find((b) => b.type === 'text')?.id;
    return id ? editors[id] : undefined;
  }

  // Exposed to the external mic + polish/discard controls (NotesPanel / ZenMode bind this).
  export function handleFinal(t: string) {
    targetEditor()?.handleFinal(t);
  }
  export function handleInterim(t: string) {
    targetEditor()?.handleInterim(t);
  }
  export function polishFocused() {
    targetEditor()?.polishPending();
  }
  export function discardFocused() {
    targetEditor()?.discardPending();
  }
  export function hasPendingFocused(): boolean {
    return targetEditor()?.hasPending() ?? false;
  }

  // Which embedded-block summaries are expanded (side-menu view).
  let expanded = $state<Set<string>>(new Set());
  function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function rawSrc(fileId: string): string {
    return `/api/files/${fileId}/raw`;
  }

  // ── Note "Polish" review ───────────────────────────────────────────────────
  // The proposal is a shared (module-level) provisional change set, so it survives
  // switching between the side-menu and zen views and is shown as a confirm/reject
  // diff. The Polish *trigger* lives on the buttons (NotesPanel / ZenMode).
  const proposal = $derived(getProposal(note.id));
  // Titles just filled by polish → one-shot "committed" animation.
  let justFilled = $state<Set<string>>(new Set());

  function confirmPolish() {
    const filled = applyProposal(note.id);
    justFilled = new Set(filled);
    setTimeout(() => (justFilled = new Set()), 1400);
  }
  function rejectPolish() {
    clearProposal(note.id);
  }
</script>

{#snippet textBlock(block: TextBlock, i: number)}
  <NoteEditor
    bind:this={editors[block.id]}
    {note}
    {block}
    blockHandles={!compact}
    placeholder={i === 0 ? m.note_placeholderFirstBlock() : m.note_placeholderSubsequentBlock()}
    onfocus={() => (focusedTextId = block.id)}
    oninsertblock={(type) => addBlock(note.id, type, block.id)}
  />
{/snippet}

{#snippet embedBlock(block: TodoBlock | EaselBlock, i: number, showTitle: boolean)}
  {#if block.type === 'todo'}
    {#if showTitle}
      <input
        class="nb-title"
        class:committed={justFilled.has(block.id)}
        placeholder={m.common_title?.()}
        value={block.title ?? ''}
        oninput={(e) => setBlockTitle(note.id, block.id, e.currentTarget.value)}
        aria-label={m.note_checklistTitleAria()}
      />
    {/if}
    <div class="nb-embed-body">
      <TodoChecklist {note} {block} large={!compact} />
    </div>
  {:else}
    {#if showTitle}
      <input
        class="nb-title"
        class:committed={justFilled.has(block.id)}
        placeholder={m.common_title?.()}
        value={block.title ?? ''}
        oninput={(e) => setBlockTitle(note.id, block.id, e.currentTarget.value)}
        aria-label={m.note_boardTitleAria()}
      />
    {/if}
    <Button type="button" class="easel-card" onclick={() => onopeneasel?.(block)}>
      {#if block.items.length > 0}
        <div class="easel-thumbs" aria-hidden="true">
          {#each block.items.slice(0, 3) as it (it.id)}
            {#if it.type === 'image'}
              <img class="easel-thumb" src={rawSrc(it.fileId)} alt="" loading="lazy" />
            {:else}
              <span class="easel-thumb easel-thumb-text">{it.text || m.note_textDefault()}</span>
            {/if}
          {/each}
          {#if block.items.length > 3}<span class="easel-more">+{block.items.length - 3}</span>{/if}
        </div>
      {/if}
      <div class="easel-meta">
        {#if block.items.length > 0}
          <span class="easel-count"
            ><ImageIcon size={13} />
            {block.items.length}
            {block.items.length === 1 ? m.note_itemSingular() : m.note_itemPlural()}</span
          >
        {:else}
          <span class="easel-count"><LayoutDashboard size={13} /> {m.note_easelEmpty()}</span>
        {/if}
        <span class="easel-open">{m.note_openBoard()}</span>
      </div>
    </Button>
  {/if}
  <div class="nb-ctl">
    <Button
      type="button"
      title={m.note_moveUp()}
      aria-label={m.note_moveUp()}
      disabled={i === 0}
      onclick={() => moveBlock(note.id, block.id, -1)}><ChevronUp size={13} /></Button
    >
    <Button
      type="button"
      title={m.note_moveDown()}
      aria-label={m.note_moveDown()}
      disabled={i === note.blocks.length - 1}
      onclick={() => moveBlock(note.id, block.id, 1)}><ChevronDown size={13} /></Button
    >
    <Button
      type="button"
      class="del"
      title={m.common_remove()}
      aria-label={m.common_remove()}
      onclick={() => removeBlock(note.id, block.id)}><Trash2 size={13} /></Button
    >
  </div>
{/snippet}

<div class="note-blocks">
  {#if proposal?.status === 'ready'}
    <!-- Polish review: provisional changes shown as a diff, confirm or reject. -->
    <div class="nb-review" transition:slide={{ duration: 160 }}>
      <div class="nb-review-head">
        <Wand2 size={13} />
        {m.note_polishedAs({ intent: proposal.intent })} — {m.note_reviewChanges()}
      </div>
      {#if proposal.noteTitle}
        <div class="nb-rv-row">
          <span class="nb-rv-label">Title</span><span class="d-add">{proposal.noteTitle.to}</span>
        </div>
      {/if}
      {#each proposal.blockTitles as bt (bt.id)}
        <div class="nb-rv-row">
          <span class="nb-rv-label">{m.note_blockTitle()}</span><span class="d-add">{bt.to}</span>
        </div>
      {/each}
      {#each proposal.textBlocks as tb (tb.id)}
        <div class="nb-diff">
          {#each wordDiff(tb.from, tb.to) as s, si (si)}<span
              class={s.type === 'add' ? 'd-add' : s.type === 'del' ? 'd-del' : 'd-same'}
              >{s.text}</span
            >{/each}
        </div>
      {/each}
      <div class="nb-rv-bar">
        <Button type="button" class="nb-rv-btn reject" onclick={rejectPolish}
          ><X size={13} /> {m.note_rejectPolish()}</Button
        >
        <Button type="button" class="nb-rv-btn confirm" onclick={confirmPolish}
          ><Check size={13} /> {m.note_confirmChanges()}</Button
        >
      </div>
    </div>
  {:else}
    {#if proposal?.status === 'loading'}
      <div class="nb-status" transition:slide={{ duration: 120 }}>
        <Loader2 size={13} class="nb-spin" />
        {m.note_polishStatus()}
      </div>
    {:else if proposal?.status === 'error'}
      <div class="nb-status err" transition:slide={{ duration: 120 }}>
        {proposal.error}
        <Button type="button" class="nb-status-dismiss" onclick={rejectPolish}
          >{m.note_dismissPolish()}</Button
        >
      </div>
    {/if}

    {#if compact}
      <!-- Side-menu: embedded blocks hoisted to the top as collapsible summaries. -->
      {#each note.blocks as block, i (block.id)}
        {#if block.type !== 'text'}
          {@const count =
            block.type === 'todo'
              ? block.items.filter((x) => x.text.trim()).length
              : block.items.length}
          <div class="nb-summary" class:open={expanded.has(block.id)}>
            <div class="nb-sum-head">
              <Button
                type="button"
                class="nb-sum-toggle"
                aria-label={m.note_expandBlock()}
                onclick={() => toggleExpand(block.id)}
              >
                {#if block.type === 'todo'}<ListTodo size={14} />{:else}<LayoutDashboard
                    size={14}
                  />{/if}
              </Button>
              <input
                class="nb-sum-title"
                class:committed={justFilled.has(block.id)}
                placeholder={block.type === 'todo'
                  ? m.note_checklistDefault()
                  : m.note_boardDefault()}
                value={block.title ?? ''}
                oninput={(e) => setBlockTitle(note.id, block.id, e.currentTarget.value)}
                aria-label={m.note_blockTitleSummary()}
              />
              <span class="nb-sum-count"
                >{count} {count === 1 ? m.note_itemCountSingular() : m.note_itemCountPlural()}</span
              >
              <Button
                type="button"
                class="nb-sum-toggle"
                aria-label={m.note_collapseBlock()}
                onclick={() => toggleExpand(block.id)}
              >
                <ChevronDown class="nb-sum-chev {expanded.has(block.id) ? 'rot' : ''}" size={14} />
              </Button>
            </div>
            {#if expanded.has(block.id)}
              <div class="nb-sum-body">{@render embedBlock(block, i, false)}</div>
            {/if}
          </div>
        {/if}
      {/each}
      {#each note.blocks as block, i (block.id)}
        {#if block.type === 'text'}
          <div class="nb-block">{@render textBlock(block, i)}</div>
        {/if}
      {/each}
    {:else}
      <!-- Zen: blocks rendered inline, in order. -->
      {#each note.blocks as block, i (block.id)}
        <div class="nb-block" class:embed={block.type !== 'text'}>
          {#if block.type === 'text'}{@render textBlock(block, i)}{:else}{@render embedBlock(
              block,
              i,
              true,
            )}{/if}
        </div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .note-blocks {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  /* Collapsible embedded-block summary (side-menu). */
  .nb-summary {
    border-radius: var(--radius-xl);
    background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
    overflow: hidden;
  }
  .nb-sum-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-2) var(--space-2);
  }
  :global(.nb-sum-toggle) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    flex-shrink: 0;
    transition: background var(--duration-fast) ease;
  }
  :global(.nb-sum-toggle):hover {
    background: color-mix(in srgb, var(--color-foreground) 7%, transparent);
  }
  :global(.nb-sum-toggle) :global(svg) {
    color: var(--color-accent);
  }
  .nb-sum-title {
    flex: 1;
    min-width: 0;
    font-family: inherit;
    font-size: var(--font-size-caption);
    font-weight: 600;
    text-align: left;
    background: transparent;
    border: none;
    outline: none;
    color: color-mix(in srgb, var(--color-foreground) 88%, transparent);
    text-overflow: ellipsis;
  }
  .nb-sum-title::placeholder {
    color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
    font-weight: 500;
  }
  .nb-sum-count {
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
    flex-shrink: 0;
  }
  :global(.nb-sum-toggle) :global(.nb-sum-chev) {
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
    transition: transform var(--duration-fast) ease;
  }
  :global(.nb-sum-toggle) :global(.nb-sum-chev.rot) {
    transform: rotate(180deg);
  }
  .nb-sum-body {
    padding: 0 10px 8px;
  }
  .nb-block.embed {
    position: relative;
    border-radius: var(--radius-xl);
    padding: var(--space-2) var(--space-2) var(--space-1);
    background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
  }
  /* Embedded block title (todo/easel). */
  .nb-title {
    width: 100%;
    margin: 0 0 6px;
    padding: var(--space-0-5) var(--space-0-5);
    background: transparent;
    border: none;
    outline: none;
    font-family: inherit;
    font-size: var(--font-size-body);
    font-weight: 600;
    color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
  }
  .nb-title::placeholder {
    color: color-mix(in srgb, var(--color-foreground) 28%, transparent);
    font-weight: 500;
  }
  /* Provisional → committed: a one-shot accent flash when AI fills a title. */
  .nb-title.committed,
  .nb-sum-title.committed {
    animation: nb-commit 1.3s ease-out;
  }
  @keyframes nb-commit {
    0% {
      color: var(--color-accent);
      background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    }
    100% {
      color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
      background: transparent;
    }
  }

  /* Note-polish intent chips (below the note). */
  /* Polish status pill (loading / error). */
  .nb-status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-2);
    font-size: var(--font-size-caption);
    border-radius: var(--radius-lg);
    color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 22%, transparent);
  }
  .nb-status.err {
    color: var(--color-accent);
  }
  :global(.nb-status-dismiss) {
    margin-left: auto;
    font-family: inherit;
    font-size: var(--font-size-caption);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-md);
    cursor: pointer;
    color: inherit;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--color-foreground) 18%, transparent);
  }
  :global(.nb-status .nb-spin) {
    animation: nb-rot 0.8s linear infinite;
  }
  @keyframes nb-rot {
    to {
      transform: rotate(360deg);
    }
  }

  /* Polish review (confirm/reject diff). */
  .nb-review {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-xl);
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 28%, transparent);
  }
  .nb-review-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 60%, transparent);
  }
  .nb-review-head :global(svg) {
    color: color-mix(in srgb, var(--color-purple) 95%, transparent);
  }
  .nb-rv-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--font-size-body);
  }
  .nb-rv-label {
    flex-shrink: 0;
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }
  .nb-diff {
    font-size: var(--font-size-body);
    line-height: 1.6;
    color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .d-del {
    text-decoration: line-through;
    color: color-mix(in srgb, var(--color-brand) 85%, transparent);
    background: color-mix(in srgb, var(--color-brand) 10%, transparent);
  }
  .d-add {
    color: color-mix(in srgb, var(--color-success) 95%, transparent);
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
    border-radius: var(--radius-sm);
  }
  .nb-rv-bar {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-0-5);
  }
  :global(.nb-rv-btn) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-caption);
    font-family: inherit;
    font-weight: 500;
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition:
      filter var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  :global(.nb-rv-btn.reject) {
    color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--color-foreground) 16%, transparent);
  }
  :global(.nb-rv-btn.reject):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
  }
  :global(.nb-rv-btn.confirm) {
    color: var(--color-accent-foreground, var(--color-foreground));
    background: var(--color-accent);
    border: 1px solid var(--color-accent);
  }
  :global(.nb-rv-btn.confirm):hover {
    filter: brightness(1.08);
  }
  .nb-ctl {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-0-5);
    margin-top: var(--space-1);
    opacity: 0;
    transition: opacity var(--duration-fast) ease;
  }
  .nb-block.embed:hover .nb-ctl,
  .nb-block.embed:focus-within .nb-ctl {
    opacity: 1;
  }
  .nb-ctl :global([data-part='button']) {
    display: inline-flex;
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  .nb-ctl :global([data-part='button']):hover:not(:disabled) {
    color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
  }
  .nb-ctl :global([data-part='button']):disabled {
    opacity: 0.3;
    cursor: default;
  }
  .nb-ctl :global([data-part='button'].del):hover {
    color: var(--color-accent);
  }

  /* Easel block preview card. */
  :global(.easel-card) {
    width: 100%;
    padding: var(--space-1);
    border-radius: var(--radius-lg);
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
    background: transparent;
    border: none;
    font-family: inherit;
    transition: color var(--duration-fast) ease;
  }
  :global(.easel-card > span) {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
  }
  :global(.easel-card):hover {
    color: var(--color-foreground);
  }
  .easel-thumbs {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
  .easel-thumb {
    width: 56px;
    height: 42px;
    flex-shrink: 0;
    object-fit: cover;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
  }
  .easel-thumb-text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    padding: var(--space-1) var(--space-1);
    font-size: var(--font-size-telemetry);
    line-height: 1.25;
    color: color-mix(in srgb, var(--color-foreground) 60%, transparent);
    overflow: hidden;
    white-space: normal;
    word-break: break-word;
  }
  .easel-more {
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 60%, transparent);
  }
  .easel-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .easel-count {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
  }
  .easel-open {
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-purple) 85%, transparent);
  }
</style>
