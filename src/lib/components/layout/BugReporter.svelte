<script lang="ts">
  import { X, Flame, AlertTriangle, Minus, Leaf, ChevronDown, ChevronUp, ImagePlus, Minimize2, Bug } from 'lucide-svelte';
  import { bugReporter, submitReport, cancelReport, handlePaste, removePastedImage, minimizeReport, restoreReport, handleEsc } from '$lib/state/ui/bug-reporter.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';

  let dialogEl: HTMLDialogElement | undefined = $state();

  const isOpen = $derived(bugReporter.phase === 'previewing');
  const isMinimized = $derived(bugReporter.phase === 'minimized');
  const showFlash = $derived(bugReporter.flashVisible);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && (isOpen || isMinimized)) {
      e.preventDefault();
      handleEsc();
    }
  }

  function openScreenshotDialog() {
    dialogEl?.showModal();
  }

  function closeScreenshotDialog() {
    dialogEl?.close();
  }

  const severityOptions = $derived([
    { value: 'critical' as const, label: m.bug_severityCritical(), Icon: Flame, color: 'text-destructive' },
    { value: 'high' as const, label: m.bug_severityHigh(), Icon: AlertTriangle, color: 'text-warning' },
    { value: 'medium' as const, label: m.bug_severityMedium(), Icon: Minus, color: 'text-accent' },
    { value: 'low' as const, label: m.bug_severityLow(), Icon: Leaf, color: 'text-success' },
  ] as const);

  const logLevelDot: Record<string, string> = {
    error: 'bg-destructive',
    warn: 'bg-warning',
    info: 'bg-accent',
    log: 'bg-muted-foreground',
  };
</script>

<svelte:window onkeydown={handleKeydown} onpaste={handlePaste} />

<!-- Camera flash overlay -->
{#if showFlash}
  <div
    data-no-capture
    class="fixed inset-0 z-[var(--layer-debug)] pointer-events-none"
    style="background: color-mix(in srgb, var(--color-warning-fg) 12%, var(--color-text-primary)); animation: camera-flash var(--duration-normal) var(--ease-exit) forwards;"
  ></div>
{/if}

<!-- Card overlay -->
{#if isOpen}
  <!-- Backdrop (click to minimize) -->
  <Button variant="ghost" size="xs"
    data-no-capture
    class="fixed inset-0 !h-auto z-[var(--layer-command)] cursor-default"
    onclick={minimizeReport}
    aria-label="Minimize bug reporter"
    tabindex="-1"
  ></Button>

  <div
    data-no-capture
    class="fixed bottom-5 right-5 z-[var(--layer-debug)] w-[420px] max-sm:left-3 max-sm:right-3 max-sm:w-auto bg-bg2 border border-border rounded-xl shadow-lg overflow-hidden"
    style="animation: card-expand var(--duration-normal) var(--ease-spring) forwards;"
    role="dialog"
    aria-modal="true"
    aria-label={m.bug_dialogLabel()}
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border">
      <h3 class="text-sm font-semibold text-foreground">{m.bug_title()}</h3>
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="xs" onclick={minimizeReport} class="text-muted hover:text-foreground transition-colors p-0.5 rounded" aria-label="Minimize" title="Minimize (ESC)">
          <Minimize2 size={14} />
        </Button>
        <Button variant="ghost" size="xs" onclick={cancelReport} class="text-muted hover:text-destructive transition-colors p-0.5 rounded" aria-label="Discard report" title="Discard (ESC ESC)">
          <X size={16} />
        </Button>
      </div>
    </div>

    <div class="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
      <!-- Screenshot thumbnail -->
      {#if bugReporter.screenshotDataUrl}
        <Button variant="ghost" size="xs"
          onclick={openScreenshotDialog}
          class="w-full !h-auto aspect-video rounded-lg overflow-hidden border border-border hover:border-accent/40 transition-colors cursor-pointer [&>span]:w-full [&>span]:h-full"
        >
          <img
            src={bugReporter.screenshotDataUrl}
            alt={m.bug_screenshotPreviewAlt()}
            class="w-full h-full object-cover"
          />
        </Button>
      {:else}
        <div class="w-full aspect-video rounded-lg border border-border bg-bg3 flex items-center justify-center text-muted-foreground text-xs">
          {m.bug_noScreenshot()}
        </div>
      {/if}

      <!-- Pasted images -->
      {#if bugReporter.pastedImages.length > 0}
        <div>
          <p class="text-xs text-muted mb-1.5 flex items-center gap-1">
            <ImagePlus size={12} />
            Pasted images ({bugReporter.pastedImages.length})
          </p>
          <div class="flex flex-wrap gap-2">
            {#each bugReporter.pastedImages as img, i}
              <div class="relative group w-20 h-20 rounded-lg overflow-hidden border border-border">
                <img src={img} alt="Pasted {i + 1}" class="w-full h-full object-cover" />
                <Button variant="ghost" size="xs"
                  onclick={() => removePastedImage(i)}
                  class="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-bg/80 text-muted hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove image"
                >
                  <X size={12} />
                </Button>
              </div>
            {/each}
          </div>
        </div>
      {:else if bugReporter.phase === 'previewing'}
        <p class="text-[length:var(--font-size-label)] text-muted-strong text-center">Paste images from clipboard (Ctrl+V)</p>
      {/if}

      <!-- Console logs (collapsible) -->
      {#if bugReporter.consoleLogs.length > 0}
        <div class="border border-border rounded-lg overflow-hidden">
          <Button variant="ghost" size="xs"
            onclick={() => (bugReporter.logsCollapsed = !bugReporter.logsCollapsed)}
            class="w-full !h-auto flex items-center justify-between px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors [&>span]:w-full [&>span]:justify-between"
          >
            <span>{m.bug_consoleLogs({ count: bugReporter.consoleLogs.length })}</span>
            {#if bugReporter.logsCollapsed}
              <ChevronDown size={14} />
            {:else}
              <ChevronUp size={14} />
            {/if}
          </Button>

          {#if !bugReporter.logsCollapsed}
            <div class="max-h-40 overflow-y-auto border-t border-border" role="log">
              {#each bugReporter.consoleLogs.slice(-30) as entry}
                <div class="flex items-start gap-2 px-3 py-1 text-[length:var(--font-size-label)] font-mono text-muted hover:bg-bg3/50">
                  <span class="shrink-0 mt-1 w-2 h-2 rounded-full {logLevelDot[entry.level] ?? 'bg-muted-foreground'}"></span>
                  <span class="truncate">{entry.message}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Severity picker -->
      <div role="radiogroup" aria-label={m.bug_severityLabel()}>
        <p class="text-xs text-muted mb-2">{m.bug_severityLabel()}</p>
        <div class="grid grid-cols-4 gap-1.5">
          {#each severityOptions as opt}
            <Button variant="ghost" size="xs"
              onclick={() => (bugReporter.severity = opt.value)}
              class="!h-auto flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-xs transition-all duration-[var(--duration-fast)] [&>span]:flex-col
                {bugReporter.severity === opt.value
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-border text-muted hover:border-border hover:text-foreground hover:bg-bg3'}"
              role="radio"
              aria-checked={bugReporter.severity === opt.value}
            >
              <opt.Icon size={16} class={opt.color} />
              <span>{opt.label}</span>
            </Button>
          {/each}
        </div>
      </div>

      <!-- Comment textarea -->
      <div>
        <label for="bug-comment" class="text-xs text-muted block mb-1.5">{m.bug_commentLabel()}</label>
        <textarea
          id="bug-comment"
          bind:value={bugReporter.comment}
          placeholder={m.bug_commentPlaceholder()}
          rows={3}
          class="w-full px-3 py-2 text-sm bg-bg border border-border rounded-lg text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/50 resize-none"
        ></textarea>
      </div>
    </div>

    <!-- Action row -->
    <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
      <Button variant="ghost" size="xs"
        onclick={cancelReport}
        class="px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors rounded-md"
      >
        {m.common_cancel()}
      </Button>
      <Button variant="ghost" size="xs"
        onclick={() => submitReport()}
        class="px-4 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded-md hover:bg-accent/90 transition-colors"
      >
        {m.bug_submit()}
      </Button>
    </div>
  </div>
{/if}

<!-- Minimized pill -->
{#if isMinimized}
  <div
    data-no-capture
    class="fixed bottom-5 right-5 z-[var(--layer-debug)] flex items-center gap-2 bg-bg2 border border-border rounded-full shadow-lg overflow-hidden"
  >
    <Button variant="ghost" size="xs"
      onclick={restoreReport}
      class="flex items-center gap-2 px-4 py-2.5 hover:bg-bg3/50 transition-colors"
      aria-label="Restore bug report"
    >
      <Bug size={16} class="text-accent" />
      <span class="text-xs font-medium text-foreground">Bug Draft</span>
      {#if bugReporter.comment}
        <span class="text-[length:var(--font-size-label)] text-muted truncate max-w-[120px]">{bugReporter.comment.slice(0, 30)}</span>
      {/if}
    </Button>
    <Button variant="ghost" size="xs"
      onclick={cancelReport}
      class="px-2.5 py-2.5 text-muted hover:text-destructive hover:bg-bg3/50 transition-colors border-l border-border"
      aria-label="Discard report"
      title="Discard"
    >
      <X size={14} />
    </Button>
  </div>
{/if}

<!-- Full-size screenshot dialog -->
<dialog
  bind:this={dialogEl}
  class="max-w-[90vw] max-h-[90vh] p-0 bg-transparent backdrop:bg-[var(--color-overlay)] rounded-xl"
  onclick={(e) => { if (e.target === dialogEl) closeScreenshotDialog(); }}
>
  {#if bugReporter.screenshotDataUrl}
    <img
      src={bugReporter.screenshotDataUrl}
      alt={m.bug_screenshotFullAlt()}
      class="max-w-full max-h-[90vh] rounded-xl"
    />
  {/if}
</dialog>
