<script lang="ts">
    import { Carta } from 'carta-md';
    import DOMPurify from 'dompurify';
    import { goto } from '$app/navigation';
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
        margin: 0.25rem 0;
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
        margin: 0.6rem 0 0.3rem;
        font-weight: 700;
        line-height: 1.25;
    }
    .chat-md :global(h1) {
        font-size: 1rem;
    }
    .chat-md :global(h2) {
        font-size: 0.95rem;
    }
    .chat-md :global(h3) {
        font-size: 0.875rem;
    }
    .chat-md :global(h4) {
        font-size: 0.8125rem;
    }

    /* Lists */
    .chat-md :global(ul),
    .chat-md :global(ol) {
        margin: 0.3rem 0;
        padding-left: 1.25rem;
    }
    .chat-md :global(li) {
        margin: 0.1rem 0;
    }
    .chat-md :global(li > p) {
        margin: 0;
    }

    /* Inline + block code */
    .chat-md :global(code) {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.78em;
        padding: 0.1em 0.35em;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.08);
    }
    .chat-md :global(pre) {
        margin: 0.5rem 0;
        padding: 0.6rem 0.75rem;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.06);
        overflow-x: auto;
        font-size: 0.78rem;
        line-height: 1.45;
    }
    .chat-md :global(pre code) {
        background: none;
        padding: 0;
        font-size: inherit;
    }

    /* Tables */
    .chat-md :global(table) {
        margin: 0.5rem 0;
        border-collapse: collapse;
        width: 100%;
        font-size: 0.78rem;
    }
    .chat-md :global(th),
    .chat-md :global(td) {
        border: 1px solid var(--color-border);
        padding: 0.3rem 0.5rem;
        text-align: left;
        vertical-align: top;
    }
    .chat-md :global(th) {
        background: rgba(255, 255, 255, 0.04);
        font-weight: 600;
    }
    .chat-md :global(tr:nth-child(even) td) {
        background: rgba(255, 255, 255, 0.02);
    }

    /* Blockquote */
    .chat-md :global(blockquote) {
        margin: 0.4rem 0;
        padding: 0.2rem 0.75rem;
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
        margin: 0.6rem 0;
        border: 0;
        border-top: 1px solid var(--color-border);
    }

    /* Strong + emphasis weight tweak */
    .chat-md :global(strong) {
        font-weight: 700;
    }

    /* Tone: user bubble has accent background, so links/code need to invert */
    .chat-md--user :global(code) {
        background: rgba(0, 0, 0, 0.18);
    }
    .chat-md--user :global(a) {
        color: inherit;
        text-decoration-color: currentColor;
    }
</style>
