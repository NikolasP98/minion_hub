<script lang="ts">
  import { Carta } from 'carta-md';
  import DOMPurify from 'dompurify';
  import { goto } from '$lib/navigation';
  import { resolveInternalNav } from '$lib/utils/internal-nav';
  import { parseUiBlocks } from '$lib/assistant/ui-blocks';
  import AssistChoice from '$lib/components/assistant/AssistChoice.svelte';
  import type { ChoiceOption } from '$lib/assistant/guide.svelte';
  import 'carta-md/default.css';

  interface Props {
    value: string;
    /** Tone changes prose color tokens — 'user' = brand accent bg, 'assistant' = card bg */
    tone?: 'user' | 'assistant';
    class?: string;
    /**
     * Sends a `ui.choice` button's label as the user's next turn. Absent on
     * surfaces without a send path — buttons render disabled there.
     */
    onChoice?: (text: string) => void;
  }
  const { value, tone = 'assistant', class: className = '', onChoice }: Props = $props();

  // carta-md ships with remark-gfm so tables / strikethrough / task lists / autolinks work by default.
  const carta = new Carta({
    sanitizer: (html) => DOMPurify.sanitize(html),
  });

  // carta-md's <Markdown> component renders ONCE by design ("this component is
  // not reactive") — streaming text froze at the first delta and only appeared
  // in full when the committed message remounted it. Render reactively instead:
  // the sync (sanitized) parse tracks every value change instantly; the async
  // render (adds syntax highlighting) upgrades it once the text settles,
  // debounced + stale-guarded so streaming doesn't spawn a render per frame.
  // UI tool calls (```minion-ui fences) are executed by the assistant runner,
  // not read by the user — strip them here, the one render path both surfaces
  // and the streaming bubble share.
  const parsed = $derived(parseUiBlocks(value));
  const shown = $derived(parsed.text);
  // A `ui.choice` call renders as buttons inside this bubble (the reply that asked).
  const choice = $derived.by(() => {
    const c = parsed.calls.find((x) => x.tool === 'ui.choice');
    if (!c) return null;
    const opts = (Array.isArray(c.input.options) ? c.input.options : []) as ChoiceOption[];
    return { question: String(c.input.question ?? ''), options: opts.filter((o) => o?.label) };
  });
  const ssrHtml = $derived(carta.renderSSR(shown));
  let asyncHtml = $state<string | null>(null);
  let renderSeq = 0;
  $effect(() => {
    const v = shown;
    asyncHtml = null;
    const seq = ++renderSeq;
    const t = setTimeout(() => {
      void carta.render(v).then((html) => {
        if (seq === renderSeq) asyncHtml = html;
      });
    }, 150);
    return () => clearTimeout(t);
  });
  const rendered = $derived(asyncHtml ?? ssrHtml);

  // Wrap every rendered <table> in a scroll container with a top-right toggle
  // between side-scroll (default — cells never wrap, avoids the illegible
  // stacked-word columns on narrow chat panes) and compact (original 100%-width
  // wrapping). {@html} emits bare <table>, so we enhance imperatively after each
  // render. ponytail: mode resets to scroll on re-render — only happens while
  // streaming; a settled message keeps the user's toggle.
  const ICON_SCROLL =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><path d="m16 16-2 2 2 2"/><path d="M3 18h7"/></svg>';
  const ICON_COMPACT =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 8 4 4-4 4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/></svg>';
  function enhanceTables(root: HTMLElement) {
    for (const table of root.querySelectorAll<HTMLTableElement>('table')) {
      if (table.parentElement?.classList.contains('chat-table__scroll')) continue;
      const wrap = document.createElement('div');
      wrap.className = 'chat-table';
      wrap.dataset.mode = 'scroll';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-table__toggle';
      const sync = () => {
        const scroll = wrap.dataset.mode === 'scroll';
        btn.innerHTML = scroll ? ICON_SCROLL : ICON_COMPACT;
        btn.title = scroll ? 'Switch to compact (wrap) view' : 'Switch to side-scroll view';
        btn.setAttribute('aria-label', btn.title);
      };
      btn.addEventListener('click', () => {
        wrap.dataset.mode = wrap.dataset.mode === 'scroll' ? 'compact' : 'scroll';
        sync();
      });
      sync();
      const scroller = document.createElement('div');
      scroller.className = 'chat-table__scroll';
      table.replaceWith(wrap);
      scroller.appendChild(table);
      wrap.append(btn, scroller);
    }
  }
  let body = $state<HTMLElement | null>(null);
  $effect(() => {
    void rendered; // re-run after each render replaces innerHTML
    if (body) enhanceTables(body);
  });

  // Internal links (the assistant cites pages as [label](/path)) navigate within
  // the SPA instead of full-reloading. Event delegation on the wrapper — one
  // listener covers every rendered <a>. External/hash/new-tab links fall through
  // to default browser handling.
  function onLinkClick(e: MouseEvent) {
    const href = resolveInternalNav(e.target, e);
    if (!href) return;
    e.preventDefault();
    goto(href);
  }
</script>

{#if shown || choice}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class={`chat-md ${tone === 'user' ? 'chat-md--user' : 'chat-md--assistant'} ${className}`}
    onclick={onLinkClick}
  >
    {#if shown}
      <div bind:this={body} class="carta-viewer carta-theme__default markdown-body">
        <!-- eslint-disable-next-line svelte/no-at-html-tags — sanitized by carta's DOMPurify sanitizer -->
        {@html rendered}
      </div>
    {/if}
    {#if choice}
      <AssistChoice question={choice.question} options={choice.options} onPick={onChoice} />
    {/if}
  </div>
{/if}

<style>
  /* Chat-tuned prose: tighter than default, dark-mode aware via CSS vars. */
  .chat-md :global(p) {
    margin: var(--space-1) 0;
  }
  .chat-md :global(p:first-child) {
    margin-top: 0;
  }
  .chat-md :global(p:last-child) {
    margin-bottom: 0;
  }

  /* Headings */
  .chat-md :global(h1),
  .chat-md :global(h2),
  .chat-md :global(h3),
  .chat-md :global(h4) {
    margin: var(--space-2) 0 var(--space-1);
    font-weight: 700;
    line-height: 1.25;
  }
  .chat-md :global(h1) {
    font-size: var(--font-size-page-title);
  }
  .chat-md :global(h2) {
    font-size: var(--font-size-page-title);
  }
  .chat-md :global(h3) {
    font-size: var(--font-size-body);
  }
  .chat-md :global(h4) {
    font-size: var(--font-size-body);
  }

  /* Lists */
  .chat-md :global(ul),
  .chat-md :global(ol) {
    margin: var(--space-1) 0;
    padding-left: var(--space-6);
  }
  .chat-md :global(li) {
    margin: var(--space-0-5) 0;
  }
  .chat-md :global(li > p) {
    margin: 0;
  }

  /* Inline + block code */
  .chat-md :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: var(--font-size-body);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  }
  .chat-md :global(pre) {
    margin: var(--space-2) 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-canvas) 35%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 6%, transparent);
    overflow-x: auto;
    font-size: var(--font-size-body);
    line-height: 1.45;
  }
  .chat-md :global(pre code) {
    background: none;
    padding: 0;
    font-size: var(--font-size-body);
  }

  /* Tables — wrapped in .chat-table (see enhanceTables) with a scroll/compact toggle. */
  .chat-md :global(.chat-table) {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
    margin: var(--space-2) 0;
  }
  .chat-md :global(.chat-table__scroll) {
    width: 100%;
    overflow-x: auto;
  }
  .chat-md :global(.chat-table__toggle) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--control-height-xs);
    width: var(--control-height-xs);
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background var(--duration-fast) var(--ease-standard);
  }
  .chat-md :global(.chat-table__toggle:hover) {
    color: var(--color-text-primary);
    background: var(--color-surface-3);
  }
  .chat-md :global(table) {
    border-collapse: collapse;
    font-size: var(--font-size-body);
  }
  /* Side-scroll (default): cells never wrap; table can exceed the pane and scroll. */
  .chat-md :global(.chat-table[data-mode='scroll'] table) {
    width: max-content;
    min-width: 100%;
  }
  .chat-md :global(.chat-table[data-mode='scroll'] th),
  .chat-md :global(.chat-table[data-mode='scroll'] td) {
    white-space: nowrap;
  }
  /* Compact: original full-width wrapping. */
  .chat-md :global(.chat-table[data-mode='compact'] table) {
    width: 100%;
  }
  .chat-md :global(th),
  .chat-md :global(td) {
    border: 1px solid var(--color-border);
    padding: var(--space-1) var(--space-2);
    text-align: left;
    vertical-align: top;
  }
  .chat-md :global(th) {
    background: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
    font-weight: 600;
  }
  .chat-md :global(tr:nth-child(even) td) {
    background: color-mix(in srgb, var(--color-text-primary) 2%, transparent);
  }

  /* Blockquote */
  .chat-md :global(blockquote) {
    margin: var(--space-2) 0;
    padding: var(--space-1) var(--space-3);
    border-left: 3px solid var(--color-border);
    color: var(--color-muted-foreground);
  }

  /* Links */
  .chat-md :global(a) {
    color: var(--color-accent);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    text-underline-offset: 2px;
  }
  .chat-md :global(a:hover) {
    text-decoration-color: var(--color-accent);
  }

  /* Horizontal rule */
  .chat-md :global(hr) {
    margin: var(--space-2) 0;
    border: 0;
    border-top: 1px solid var(--color-border);
  }

  /* Strong + emphasis weight tweak */
  .chat-md :global(strong) {
    font-weight: 700;
  }

  /* Tone: user bubble has accent background, so links/code need to invert */
  .chat-md--user :global(code) {
    background: color-mix(in srgb, var(--color-canvas) 18%, transparent);
  }
  .chat-md--user :global(a) {
    color: inherit;
    text-decoration-color: currentColor;
  }
</style>
