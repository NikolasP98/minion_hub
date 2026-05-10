<script lang="ts">
  import { promptSections } from "$lib/state/features/prompt-sections.svelte";
  import { colorForLayer } from "$lib/utils/layer-colors";
  import { formatBytes, formatTokens } from "$lib/utils/format";
  import MarkdownView from "./MarkdownView.svelte";

  const preview = $derived(promptSections.preview);
  const loading = $derived(promptSections.previewLoading);
  const hasAgent = $derived(promptSections.agentId !== null);
  const selected = $derived(promptSections.selectedIds);
  const showInitialSpinner = $derived(hasAgent && preview === null && loading);

  // Auto-scroll to FIRST selected section when selection changes. Tracks the
  // selection set (size + first id) and avoids re-scrolling when the same
  // selection remains stable across debounced preview refreshes.
  let scrollHost = $state<HTMLDivElement | undefined>(undefined);
  let lastFocusedId: string | null = null;
  let pulseTick = $state(0);

  $effect(() => {
    const ids = selected;
    if (!preview) return;
    if (ids.size === 0) {
      lastFocusedId = null;
      return;
    }
    const first = ids.values().next().value as string;
    if (first === lastFocusedId) return;
    lastFocusedId = first;
    pulseTick++;
    queueMicrotask(() => {
      const el = scrollHost?.querySelector<HTMLElement>(
        `[data-section-id="${CSS.escape(first)}"]`,
      );
      if (!el || !scrollHost) return;
      // Compute manual scroll within the host instead of scrollIntoView — this
      // prevents ancestor overflow:hidden containers from being silently scrolled
      // by the browser, which was hiding the global topbar.
      const top = el.offsetTop - scrollHost.offsetTop - 8;
      scrollHost.scrollTo({ top, behavior: "smooth" });
    });
  });
</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Sticky totals bar -->
  <div
    class="shrink-0 border-b border-border px-4 py-2 flex items-center justify-between bg-bg1/80 backdrop-blur-sm"
  >
    <div class="text-xs uppercase tracking-wider text-muted font-medium">
      Assembled Prompt
    </div>
    <div class="flex items-center gap-3 text-xs">
      {#if preview}
        <span class="font-mono text-fg tabular-nums">
          {formatBytes(preview.totalBytes)}
        </span>
        <span class="text-muted/60">·</span>
        <span class="font-mono text-fg tabular-nums">
          {formatTokens(preview.totalTokens)}
        </span>
        {#if loading}
          <span
            class="inline-block w-3 h-3 rounded-full border-2 border-accent/40 border-t-accent animate-spin"
            aria-label="Refreshing"
          ></span>
        {/if}
      {:else}
        <span class="font-mono text-muted">-- / --</span>
      {/if}
    </div>
  </div>

  {#if showInitialSpinner}
    <div class="flex-1 flex items-center justify-center text-sm text-muted">
      <div class="flex items-center gap-2">
        <span class="inline-block w-4 h-4 rounded-full border-2 border-accent/40 border-t-accent animate-spin"></span>
        <span>Assembling…</span>
      </div>
    </div>
  {:else if !preview}
    <div class="flex-1 flex items-center justify-center text-xs text-muted px-4 text-center">
      Select an agent to preview the assembled prompt.
    </div>
  {:else}
    <div bind:this={scrollHost} class="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
      {#each preview.breakdown as row (row.id)}
        {@const isSelected = selected.has(row.id)}
        {@const color = colorForLayer(row.layer)}
        <section
          data-section-id={row.id}
          data-pulse={isSelected ? pulseTick : 0}
          class={`scroll-mt-4 rounded transition-all duration-200 border ${
            isSelected
              ? "border-accent/60 bg-accent/5 shadow-[0_0_0_1px_rgb(var(--accent-rgb,99_102_241)/0.25)] highlight-pulse"
              : "border-transparent"
          }`}
        >
          <header class="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 text-[10px]">
            <span class="w-1.5 h-1.5 rounded-full {color.dot}"></span>
            <span class="font-mono text-fg/80">{row.id}</span>
            <span class="px-1.5 py-0.5 rounded uppercase tracking-wider {color.badge}">
              {row.layer}
            </span>
            <span class="flex-1"></span>
            <span class="text-muted font-mono tabular-nums">{formatBytes(row.bytes)}</span>
            <span class="text-muted/60">·</span>
            <span class="text-muted font-mono tabular-nums">{row.tokens.toLocaleString("en-US")}</span>
          </header>
          <div class="px-4 py-2">
            {#if row.rendered}
              <MarkdownView value={row.rendered} />
            {:else}
              <pre class="text-xs font-mono whitespace-pre-wrap break-words text-fg/60">{`# ${row.id} (no content)`}</pre>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  :global(.highlight-pulse) {
    animation: pulse-fade 1.4s ease-out;
  }
  @keyframes pulse-fade {
    0% { background-color: rgb(var(--accent-rgb, 99 102 241) / 0.22); }
    100% { background-color: rgb(var(--accent-rgb, 99 102 241) / 0.05); }
  }
</style>
