<script lang="ts">
  import { Carta, Markdown } from "carta-md";
  import DOMPurify from "dompurify";
  import "carta-md/default.css";

  interface Props {
    value: string;
    class?: string;
  }
  const { value, class: className = "" }: Props = $props();

  const carta = new Carta({ sanitizer: (html) => DOMPurify.sanitize(html) });
</script>

<div class={`md-view max-w-none ${className}`}>
  <Markdown {carta} {value} />
</div>

<style>
  /* Document typography for rendered markdown. There is no Tailwind typography
     plugin in the hub, so every block element is styled here from semantic tokens.
     Rules are anchored on the component root so nothing leaks to other surfaces. */
  .md-view {
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    line-height: var(--line-height-body);
    overflow-wrap: anywhere;
  }

  .md-view :global(h1),
  .md-view :global(h2),
  .md-view :global(h3),
  .md-view :global(h4),
  .md-view :global(h5),
  .md-view :global(h6) {
    color: var(--color-text-primary);
    font-weight: 600;
    line-height: var(--line-height-heading);
    margin-top: var(--space-6);
    margin-bottom: var(--space-2);
  }
  .md-view :global(h1) {
    font-size: var(--font-size-display);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .md-view :global(h2) {
    font-size: var(--font-size-page-title);
    font-weight: 700;
    padding-bottom: var(--space-1);
    border-bottom: var(--hairline);
  }
  .md-view :global(h3) {
    font-size: var(--font-size-section-title);
  }
  .md-view :global(h4) {
    font-size: var(--font-size-body);
  }
  .md-view :global(h5),
  .md-view :global(h6) {
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }
  .md-view :global(> :first-child) {
    margin-top: 0;
  }

  .md-view :global(p),
  .md-view :global(ul),
  .md-view :global(ol),
  .md-view :global(pre),
  .md-view :global(table),
  .md-view :global(blockquote) {
    margin-top: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .md-view :global(a) {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
  .md-view :global(strong) {
    font-weight: 600;
  }

  /* Lists: restore markers Tailwind preflight removes; nested lists tighten. */
  .md-view :global(ul) {
    list-style: disc;
    padding-left: var(--space-6);
  }
  .md-view :global(ol) {
    list-style: decimal;
    padding-left: var(--space-6);
  }
  .md-view :global(li) {
    margin-top: var(--space-0-5);
    margin-bottom: var(--space-0-5);
  }
  .md-view :global(li > ul),
  .md-view :global(li > ol) {
    margin-top: var(--space-0-5);
    margin-bottom: var(--space-0-5);
  }
  .md-view :global(li > p) {
    margin: 0;
  }
  .md-view :global(li:has(> input[type="checkbox"])) {
    list-style: none;
    margin-left: calc(-1 * var(--space-6));
    padding-left: 0;
  }
  .md-view :global(input[type="checkbox"]) {
    margin-right: var(--space-2);
    vertical-align: middle;
    accent-color: var(--color-accent);
  }

  .md-view :global(blockquote) {
    border-left: var(--space-0-5) solid var(--color-border-strong);
    padding-left: var(--space-3);
    color: var(--color-text-secondary);
  }
  .md-view :global(blockquote p) {
    margin: 0;
  }

  .md-view :global(hr) {
    border: 0;
    border-top: var(--hairline);
    margin: var(--space-6) 0;
  }

  .md-view :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md);
  }

  /* Tables: hairline grid on surface-1, header on surface-2, numbers aligned. */
  .md-view :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: var(--font-size-caption);
    border: var(--hairline);
    border-radius: var(--radius-md);
  }
  .md-view :global(th),
  .md-view :global(td) {
    padding: var(--space-1) var(--space-3);
    border-bottom: var(--hairline);
    text-align: left;
    vertical-align: top;
    font-variant-numeric: tabular-nums;
  }
  .md-view :global(th) {
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-weight: 600;
    white-space: nowrap;
  }
  .md-view :global(tbody tr:last-child td) {
    border-bottom: 0;
  }
  .md-view :global(tbody tr:nth-child(even) td) {
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
  }

  /* Code: mono tokens, block on a recessed surface, inline on a tint. */
  .md-view :global(code) {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-mono);
    line-height: var(--line-height-mono);
    background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-xs);
  }
  .md-view :global(pre) {
    background: color-mix(in srgb, var(--color-canvas) 25%, transparent);
    border: var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    overflow-x: auto;
  }
  .md-view :global(pre code) {
    background: none;
    padding: 0;
    border-radius: 0;
  }
</style>
