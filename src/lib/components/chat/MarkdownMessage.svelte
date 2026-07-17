<script lang="ts">
  import { Carta } from 'carta-md';
  import DOMPurify from 'dompurify';
  import { goto } from '$lib/navigation';
  import { resolveInternalNav } from '$lib/utils/internal-nav';
  import 'carta-md/default.css';

  interface Props {
    value: string;
    /** Tone changes prose color tokens — 'user' = brand accent bg, 'assistant' = card bg */
    tone?: 'user' | 'assistant';
    class?: string;
  }
  const { value, tone = 'assistant', class: className = '' }: Props = $props();

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
  const ssrHtml = $derived(carta.renderSSR(value));
  let asyncHtml = $state<string | null>(null);
  let renderSeq = 0;
  $effect(() => {
    const v = value;
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

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class={`chat-md ${tone === 'user' ? 'chat-md--user' : 'chat-md--assistant'} ${className}`}
  onclick={onLinkClick}
>
  <div class="carta-viewer carta-theme__default markdown-body">
    <!-- eslint-disable-next-line svelte/no-at-html-tags — sanitized by carta's DOMPurify sanitizer -->
    {@html rendered}
  </div>
</div>

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

  /* Tables */
  .chat-md :global(table) {
    margin: var(--space-2) 0;
    border-collapse: collapse;
    width: 100%;
    font-size: var(--font-size-body);
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
