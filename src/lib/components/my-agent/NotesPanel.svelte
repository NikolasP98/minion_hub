<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import {
    notesState,
    sortedNotes,
    addNote,
    updateNote,
    deleteNote,
    togglePin,
    setColor,
    setNoteIcon,
    todoProgress,
    togglePanel,
    pruneEmptyNote,
    pruneEmptyNotes,
    firstEmptyNote,
    uploadNoteImage,
    addAttachment,
    NOTE_COLORS,
    COLOR_STYLES,
    type AgentNote,
  } from '$lib/state/features/agent-notes.svelte';
  import {
    StickyNote,
    ListTodo,
    Plus,
    Pin,
    Trash2,
    Search,
    Palette,
    Maximize2,
    ChevronDown,
    LayoutDashboard,
    Image as ImageIcon,
    PanelRightClose,
    Wand2,
    GripVertical,
  } from 'lucide-svelte';
  import { tick } from 'svelte';
  import { setDragContext, type DragContext } from '$lib/utils/drag-context';
  import NoteImageStrip from './NoteImageStrip.svelte';
  import ImageLightbox from './ImageLightbox.svelte';
  import NoteBlocks from './NoteBlocks.svelte';
  import NoteIconButton from './NoteIconButton.svelte';
  import PolishMenu from './PolishMenu.svelte';
  import { runPolish, clearAllProposals } from '$lib/state/features/note-polish.svelte';
  import TodoChecklist from './TodoChecklist.svelte';
  import TranscribeButton from './TranscribeButton.svelte';
  import { detectLang } from '$lib/utils/detect-lang';
  import ZenMode from './ZenMode.svelte';
  import EaselBoard from './EaselBoard.svelte';
  import type { EaselBlock } from '$lib/types/notes';

  const list = $derived(sortedNotes());
  const noteCount = $derived(notesState.notes.length);

  // Per-note NoteEditor instances — the footer mic feeds transcript text into the
  // matching editor's buffer (the pending ghost renders inside that editor).
  type EditorRef = {
    handleFinal: (t: string) => void;
    handleInterim: (t: string) => void;
  };
  const editorRefs = $state<Record<string, EditorRef | undefined>>({});
  // Which note's Polish options popover is open (footer).
  let polishMenuFor = $state<string | null>(null);

  // On nav-away: discard provisional polish proposals and delete empty notes.
  $effect(() => () => {
    clearAllProposals();
    pruneEmptyNotes();
  });

  // Collapsing the panel counts as navigating away from the notes.
  function collapsePanel() {
    pruneEmptyNotes();
    togglePanel();
  }

  // "+" — keep at most one empty note: reuse the existing empty note (focus it)
  // instead of creating another, so we never prune a note the user means to fill.
  async function addAndFocus(kind: 'note' | 'todo') {
    const n = kind === 'note' ? (firstEmptyNote() ?? addNote('note')) : addNote(kind);
    await tick();
    const card = document.getElementById(`note-${n.id}`);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card?.querySelector<HTMLInputElement>('.card-title')?.focus();
  }

  // Render URL for a stored image (easel thumbnails).
  function rawSrc(fileId: string): string {
    return `/api/files/${fileId}/raw`;
  }

  // Which card has its colour palette popover open.
  let colorMenuFor = $state<string | null>(null);
  // Fullscreen image preview source (null = closed).
  let lightboxSrc = $state<string | null>(null);
  // The note open in fullscreen focus ("zen") mode, if any.
  let zenNote = $state<AgentNote | null>(null);
  // The easel board open fullscreen, if any.
  let easelNote = $state<AgentNote | null>(null);
  // An embedded easel BLOCK open fullscreen, if any.
  let easelBlock = $state<{ note: AgentNote; block: EaselBlock } | null>(null);

  // Build a draggable context payload for a note/todo (folded into chat on drop).
  function noteDragStart(e: DragEvent, note: AgentNote) {
    const parts: string[] = [];
    if (note.kind === 'todo') {
      parts.push(`Todo list: "${note.title || '(untitled)'}"`);
      for (const it of note.items) {
        parts.push(`${it.done ? '[x]' : '[ ]'} ${it.text}`);
      }
    } else {
      parts.push(`Note: "${note.title || '(untitled)'}"`);
      const body = note.body?.trim();
      if (body) parts.push(body);
    }
    const ctx: DragContext = {
      kind: note.kind === 'todo' ? 'todo' : 'note',
      label: note.title || (note.kind === 'todo' ? 'Todo' : 'Note'),
      text: parts.join('\n'),
    };
    setDragContext(e, ctx);
  }

  // Paste an image straight onto a card (Ctrl+V while editing it).
  async function onCardPaste(e: ClipboardEvent, note: AgentNote) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      e.preventDefault();
      try {
        const fileId = await uploadNoteImage(file);
        addAttachment(note.id, fileId);
      } catch {
        /* surfaced by the strip on next interaction */
      }
    }
  }
</script>

<aside class="notes-panel" class:collapsed={!notesState.open} aria-label={m.note_ariaLabel()}>
  {#if notesState.open}
    <header class="panel-head">
      <div class="head-title">
        <StickyNote size={15} />
        <span>Notes &amp; Todos</span>
      </div>
    </header>

    <div class="search-row">
      <div class="search">
        <Search size={13} />
        <input
          type="text"
          placeholder={m.note_searchPlaceholder()}
          bind:value={notesState.query}
          aria-label={m.note_searchLabel()}
        />
      </div>
      <Button
        type="button"
        class="add-fab"
        title={m.note_addNoteTitle()}
        aria-label={m.note_addNote()}
        onclick={() => void addAndFocus('note')}
      >
        <Plus size={17} />
      </Button>
    </div>

    <div class="cards" role="list">
      {#if list.length === 0}
        <div class="empty">
          <StickyNote size={26} />
          {#if notesState.query.trim()}
            <p>{m.note_noMatches({ query: notesState.query })}</p>
          {:else}
            <p>{m.note_emptyState()}</p>
          {/if}
        </div>
      {/if}

      {#each list as note (note.id)}
        {@const style = COLOR_STYLES[note.color]}
        <article
          id="note-{note.id}"
          class="card"
          class:pinned={note.pinned}
          class:expanded={notesState.expandedId === note.id}
          role="listitem"
          style:border-color={style.border}
          style:background={style.fill}
          onpaste={(e) => onCardPaste(e, note)}
        >
          <div class="card-top">
            {#if note.kind !== 'easel'}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                class="drag-grip"
                draggable="true"
                ondragstart={(e) => noteDragStart(e, note)}
                title={m.note_dragIntoChat()}
                aria-hidden="true"
              >
                <GripVertical size={13} />
              </span>
            {/if}
            {#if note.kind === 'todo'}
              {@const p = todoProgress(note)}
              <span class="kind-badge todo" title={m.note_checklist()}>
                <ListTodo size={12} />
                {p.done}/{p.total}
              </span>
            {:else if note.kind === 'note'}
              <NoteIconButton
                icon={note.icon ?? ''}
                size={15}
                onpick={(v) => setNoteIcon(note.id, v)}
              />
            {:else}
              <span class="kind-badge note" title={m.note_easel()}
                ><LayoutDashboard size={12} /></span
              >
            {/if}
            <input
              class="card-title"
              placeholder={note.kind === 'todo'
                ? m.note_placeholderChecklistTitle()
                : m.common_title?.()}
              value={note.title}
              oninput={(e) => updateNote(note.id, { title: e.currentTarget.value })}
              aria-label={m.common_title?.()}
            />
            {#if note.kind !== 'easel'}
              {@const isExpanded = notesState.expandedId === note.id}
              <Button
                type="button"
                class="pin-btn expand-btn {isExpanded ? 'on' : ''}"
                title={isExpanded ? m.note_collapse() : m.note_expand()}
                aria-label={isExpanded ? m.note_collapse() : m.note_expand()}
                aria-expanded={isExpanded}
                onclick={() => (notesState.expandedId = isExpanded ? null : note.id)}
              >
                <ChevronDown size={15} />
              </Button>
            {/if}
            <Button
              type="button"
              class="pin-btn focus-btn"
              title={note.kind === 'easel' ? m.note_openBoard() : m.note_focusMode()}
              aria-label={m.note_openFullscreen()}
              onclick={() => (note.kind === 'easel' ? (easelNote = note) : (zenNote = note))}
            >
              <Maximize2 size={13} />
            </Button>
            <Button
              type="button"
              class="pin-btn {note.pinned ? 'on' : ''}"
              title={note.pinned ? m.note_unpin() : m.note_pinToTop()}
              onclick={() => togglePin(note.id)}
            >
              <Pin size={14} />
            </Button>
          </div>

          {#if note.kind === 'note'}
            <div class="card-body">
              <NoteBlocks
                bind:this={editorRefs[note.id]}
                {note}
                compact
                onopeneasel={(block) => (easelBlock = { note, block })}
              />
            </div>
          {:else if note.kind === 'todo'}
            <TodoChecklist {note} />
          {:else}
            {@const items = note.easel.items}
            <Button type="button" class="easel-card" onclick={() => (easelNote = note)}>
              {#if items.length > 0}
                <div class="easel-thumbs" aria-hidden="true">
                  {#each items.slice(0, 3) as it (it.id)}
                    {#if it.type === 'image'}
                      <img class="easel-thumb" src={rawSrc(it.fileId)} alt="" loading="lazy" />
                    {:else}
                      <span class="easel-thumb easel-thumb-text"
                        >{it.text || m.note_textDefault()}</span
                      >
                    {/if}
                  {/each}
                  {#if items.length > 3}
                    <span class="easel-more">+{items.length - 3}</span>
                  {/if}
                </div>
              {/if}
              <div class="easel-meta">
                {#if items.length > 0}
                  <span class="easel-count"
                    ><ImageIcon size={13} />
                    {items.length}
                    {items.length === 1 ? m.note_itemSingular() : m.note_itemPlural()}</span
                  >
                {:else}
                  <span class="easel-count"
                    ><LayoutDashboard size={13} /> {m.note_emptyBoard()}</span
                  >
                {/if}
                <span class="easel-open">{m.note_openBoard()}</span>
              </div>
            </Button>
          {/if}

          {#if note.kind !== 'easel'}
            <NoteImageStrip {note} onopen={(src) => (lightboxSrc = src)} />
          {/if}

          <footer class="card-foot">
            <div class="foot-actions">
              <div class="color-wrap">
                <Button
                  type="button"
                  class="icon-btn sm"
                  title={m.note_colorLabel()}
                  aria-label={m.note_changeColor()}
                  onclick={() => (colorMenuFor = colorMenuFor === note.id ? null : note.id)}
                >
                  <Palette size={14} />
                </Button>
                {#if colorMenuFor === note.id}
                  <div class="color-menu">
                    {#each NOTE_COLORS as c (c.id)}
                      <Button
                        type="button"
                        class="swatch {note.color === c.id ? 'active' : ''}"
                        style="background: {c.swatch}"
                        title={c.label}
                        aria-label={c.label}
                        onclick={() => {
                          setColor(note.id, c.id);
                          colorMenuFor = null;
                        }}
                      ></Button>
                    {/each}
                  </div>
                {/if}
              </div>
              {#if note.kind === 'note'}
                <div class="polish-wrap">
                  <Button
                    type="button"
                    class="icon-btn sm polish {polishMenuFor === note.id ? 'on' : ''}"
                    title={m.note_polishTitle()}
                    aria-label={m.note_polish()}
                    aria-haspopup="menu"
                    aria-expanded={polishMenuFor === note.id}
                    onclick={() => (polishMenuFor = polishMenuFor === note.id ? null : note.id)}
                  >
                    <Wand2 size={14} />
                  </Button>
                  {#if polishMenuFor === note.id}
                    <div class="polish-pop">
                      <PolishMenu
                        onpick={(intent) => void runPolish(note, intent)}
                        onclose={() => (polishMenuFor = null)}
                      />
                    </div>
                  {/if}
                </div>
                <span class="foot-sep" aria-hidden="true"></span>
                <!-- Device-mic transcription only here; tab audio + polish live in zen. -->
                <TranscribeButton
                  compact
                  allowTab={false}
                  detectedLang={() => detectLang(note.body ?? '')}
                  onfinal={(t) => editorRefs[note.id]?.handleFinal(t)}
                  oninterim={(t) => editorRefs[note.id]?.handleInterim(t)}
                />
              {/if}
            </div>
            <Button
              type="button"
              class="icon-btn sm danger"
              title={m.common_delete()}
              aria-label={m.common_delete()}
              onclick={() => deleteNote(note.id)}
            >
              <Trash2 size={14} />
            </Button>
          </footer>
        </article>
      {/each}
    </div>

    <!-- Inner-bottom collapse, mirroring the main nav's collapse control. -->
    <footer class="panel-foot">
      <Button
        type="button"
        class="collapse-row"
        onclick={collapsePanel}
        aria-label={m.note_collapsePanel()}
      >
        <PanelRightClose size={16} />
        <span>{m.note_collapse()}</span>
      </Button>
    </footer>
  {:else}
    <!-- Collapsed: a slim discoverable rail. Click anywhere to expand. -->
    <Button type="button" class="rail" onclick={togglePanel} aria-label={m.note_openPanel()}>
      <span class="rail-icon">
        <StickyNote size={18} />
        {#if noteCount > 0}<span class="rail-badge">{noteCount}</span>{/if}
      </span>
      <span class="rail-label">{m.note_panelLabel()}</span>
    </Button>
  {/if}
</aside>

<ImageLightbox src={lightboxSrc} onclose={() => (lightboxSrc = null)} />

<ZenMode
  note={zenNote}
  onclose={() => {
    const id = zenNote?.id;
    zenNote = null;
    if (id) pruneEmptyNote(id);
  }}
/>

{#if easelNote}
  <EaselBoard note={easelNote} onclose={() => (easelNote = null)} />
{/if}

{#if easelBlock}
  <EaselBoard note={easelBlock.note} block={easelBlock.block} onclose={() => (easelBlock = null)} />
{/if}

<svelte:window
  onpointerdown={(e) => {
    if (polishMenuFor && e.target instanceof Element && !e.target.closest('.polish-wrap'))
      polishMenuFor = null;
  }}
/>

<style>
  .notes-panel {
    position: relative;
    width: 320px;
    flex-shrink: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--color-bg);
    border-left: 1px solid var(--color-border);
    transition: width var(--duration-fast) cubic-bezier(0.4, 0, 0.2, 1);
  }
  .notes-panel.collapsed {
    width: 46px;
  }

  /* Inner-bottom collapse control, mirroring the main nav's collapse button. */
  .panel-foot {
    flex-shrink: 0;
    padding: var(--space-2);
    border-top: 1px solid var(--color-border);
  }
  :global(.collapse-row) {
    width: 100%;
    height: 2.25rem;
    padding: 0 0.625rem;
    border-radius: var(--radius-md, 8px);
    font-size: var(--font-size-caption);
    font-weight: 500;
    cursor: pointer;
    background: transparent;
    border: none;
    color: var(--color-muted);
    font-family: inherit;
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  :global(.collapse-row > span) {
    gap: var(--space-3);
  }
  :global(.collapse-row):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
  }

  /* Collapsed rail: vertical, discoverable, click-to-expand. */
  :global(.rail) {
    flex: 1;
    min-height: 0;
    width: 100%;
    padding: var(--space-12) 0 var(--space-4);
    cursor: pointer;
    background: transparent;
    border: none;
    color: var(--color-muted);
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  :global(.rail > span) {
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }
  :global(.rail):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
  }
  .rail-icon {
    position: relative;
    display: inline-flex;
    color: var(--color-accent);
  }
  .rail-badge {
    position: absolute;
    top: -7px;
    right: -9px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-telemetry);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    border-radius: var(--radius-full);
    color: var(--color-accent-foreground);
    background: var(--color-accent);
  }
  .rail-label {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    font-size: var(--font-size-caption);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--color-muted-foreground);
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-3) var(--space-2);
    flex-shrink: 0;
  }
  .head-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-body);
    font-weight: 600;
    color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
  }
  .head-title :global(svg) {
    color: var(--color-accent);
  }

  .search-row {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    margin: 0 14px 10px;
    flex-shrink: 0;
  }
  :global(.add-fab) {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    border-radius: var(--radius-lg);
    cursor: pointer;
    color: var(--color-accent-foreground, var(--color-foreground));
    background: var(--color-accent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 70%, transparent);
    transition:
      filter var(--duration-fast) ease,
      transform var(--duration-fast) ease;
  }
  :global(.add-fab):hover {
    filter: brightness(1.08);
  }
  :global(.add-fab):active {
    transform: scale(0.95);
  }

  .search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 7%, transparent);
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
    font-size: var(--font-size-caption);
    font-family: inherit;
  }
  .search input::placeholder {
    color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
  }

  .cards {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    padding: var(--space-0-5) var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    text-align: center;
    padding: var(--space-8) var(--space-3);
    color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
  }
  .empty p {
    margin: 0;
    font-size: var(--font-size-caption);
    max-width: 26ch;
    line-height: 1.5;
  }

  .card {
    border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
    border-radius: var(--radius-xl);
    padding: var(--space-2) var(--space-2) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .card.pinned {
    box-shadow: var(--shadow-elevation-2);
  }

  .card-top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .drag-grip {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    margin: 0 -2px 0 -4px;
    cursor: grab;
    color: color-mix(in srgb, var(--color-foreground) 22%, transparent);
    transition: color var(--duration-fast) ease;
  }
  .drag-grip:hover {
    color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
  }
  .drag-grip:active {
    cursor: grabbing;
  }
  .kind-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    flex-shrink: 0;
    font-size: var(--font-size-telemetry);
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, var(--color-foreground) 50%, transparent);
  }
  .card-title {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
    font-size: var(--font-size-body);
    font-weight: 600;
    font-family: inherit;
    padding: 0;
  }
  .card-title::placeholder {
    color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
    font-weight: 500;
  }

  :global(.pin-btn) {
    flex-shrink: 0;
    display: inline-flex;
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
    transition:
      color var(--duration-fast) ease,
      transform var(--duration-fast) ease;
  }
  :global(.pin-btn):hover {
    color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
  }
  :global(.pin-btn):global(.on) {
    color: var(--color-accent);
    transform: rotate(20deg);
  }

  .card-body {
    width: 100%;
    min-height: 36px;
    resize: none;
    overflow: hidden;
    background: transparent;
    border: none;
    outline: none;
    color: color-mix(in srgb, var(--color-foreground) 82%, transparent);
    font-size: var(--font-size-caption);
    line-height: 1.55;
    font-family: inherit;
    padding: 0;
  }
  .card-body::placeholder {
    color: color-mix(in srgb, var(--color-foreground) 28%, transparent);
  }

  /* Inline compact/expand: a collapsed card clamps its content to a short
	   preview so the whole list stays scannable; expanding one (only one at a
	   time — see notesState.expandedId) gives it the real-estate. Applies to the
	   note body and the todo checklist; easel cards are already a fixed preview. */
  .card:not(.expanded) .card-body,
  .card:not(.expanded) :global(.todo-list) {
    max-height: 5.4em;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to bottom, var(--color-bg) 62%, transparent);
    mask-image: linear-gradient(to bottom, var(--color-bg) 62%, transparent);
  }

  /* Chevron toggle: points right (collapsed) → down (expanded), matching the
	   feed section toggle idiom. */
  :global(.expand-btn) :global(svg) {
    transition: transform var(--duration-fast) ease;
    transform: rotate(-90deg);
  }
  :global(.expand-btn):global(.on) :global(svg) {
    transform: rotate(0deg);
  }
  :global(.expand-btn):global(.on) {
    color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
  }

  .card-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-0-5);
  }
  .foot-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .foot-sep {
    width: 1px;
    height: 16px;
    background: color-mix(in srgb, var(--color-foreground) 14%, transparent);
  }
  .color-wrap {
    position: relative;
  }
  .color-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: var(--layer-sticky);
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-2);
    border-radius: var(--radius-xl);
    background: var(--color-bg2);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
    box-shadow: var(--shadow-overlay);
  }
  :global(.swatch) {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--color-foreground) 15%, transparent);
    transition: transform var(--duration-instant) ease;
  }
  :global(.swatch):hover {
    transform: scale(1.15);
  }
  :global(.swatch):global(.active) {
    box-shadow: var(--shadow-elevation-2);
  }

  :global(.icon-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    border-radius: var(--radius-lg);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  :global(.icon-btn):hover {
    color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
  }
  :global(.icon-btn):global(.sm) {
    padding: var(--space-1);
  }
  :global(.icon-btn):global(.danger):hover {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  :global(.icon-btn):global(.polish):hover,
  :global(.icon-btn):global(.polish):global(.on) {
    color: var(--color-purple);
    background: color-mix(in srgb, var(--color-purple) 12%, transparent);
  }
  .polish-wrap {
    position: relative;
    display: inline-flex;
  }
  .polish-pop {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    z-index: var(--layer-navigation);
  }

  :global(.easel-card) {
    width: 100%;
    padding: var(--space-2);
    border-radius: var(--radius-xl);
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-purple) 8%, transparent),
        color-mix(in srgb, var(--color-accent) 6%, transparent)
      ),
      repeating-linear-gradient(
        45deg,
        transparent,
        transparent 9px,
        color-mix(in srgb, var(--color-foreground) 2%, transparent) 9px,
        color-mix(in srgb, var(--color-foreground) 2%, transparent) 10px
      );
    border: 1px dashed color-mix(in srgb, var(--color-foreground) 14%, transparent);
    transition:
      border-color var(--duration-fast) ease,
      color var(--duration-fast) ease;
    font-family: inherit;
  }
  :global(.easel-card > span) {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
  }
  :global(.easel-card):hover {
    color: var(--color-foreground);
    border-color: color-mix(in srgb, var(--color-purple) 50%, transparent);
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
    border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);
    background: color-mix(in srgb, var(--color-bg) 25%, transparent);
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
    font-variant-numeric: tabular-nums;
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
