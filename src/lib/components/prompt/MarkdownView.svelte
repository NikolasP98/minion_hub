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
    font-size: 0.75rem;
    line-height: 1.4;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    padding: 0.5rem;
    overflow-x: auto;
  }
  :global(.prose code) {
    font-size: 0.75rem;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  :global(.prose pre code) {
    background: none;
    padding: 0;
  }
  :global(.prose h1, .prose h2, .prose h3, .prose h4) {
    margin-top: 0.75rem;
    margin-bottom: 0.4rem;
  }
  :global(.prose h2) {
    font-size: 0.95rem;
    font-weight: 700;
  }
  :global(.prose h3) {
    font-size: 0.85rem;
    font-weight: 600;
  }
  :global(.prose p, .prose ul, .prose ol) {
    margin-top: 0.4rem;
    margin-bottom: 0.4rem;
  }
  :global(.prose ul, .prose ol) {
    padding-left: 1.25rem;
  }
</style>
