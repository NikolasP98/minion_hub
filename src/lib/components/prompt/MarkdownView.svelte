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

<div class={`prose prose-invert max-w-none text-sm ${className}`}>
  <Markdown {carta} {value} />
</div>

<style>
  /* Prose tweaks: tighter spacing, monospace pre/code, accent inline code. */
  :global(.prose pre) {
    font-size: var(--font-size-caption);
    line-height: 1.4;
    background: color-mix(in srgb, var(--color-canvas) 25%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 6%, transparent);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    overflow-x: auto;
  }
  :global(.prose code) {
    font-size: var(--font-size-caption);
    background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-xs);
  }
  :global(.prose pre code) {
    background: none;
    padding: 0;
  }
  :global(.prose h1, .prose h2, .prose h3, .prose h4) {
    margin-top: var(--space-3);
    margin-bottom: var(--space-2);
  }
  :global(.prose h2) {
    font-size: var(--font-size-page-title);
    font-weight: 700;
  }
  :global(.prose h3) {
    font-size: var(--font-size-body);
    font-weight: 600;
  }
  :global(.prose p, .prose ul, .prose ol) {
    margin-top: var(--space-2);
    margin-bottom: var(--space-2);
  }
  :global(.prose ul, .prose ol) {
    padding-left: var(--space-6);
  }
</style>
