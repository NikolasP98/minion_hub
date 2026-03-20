<script lang="ts">
  import { X, Flame, AlertTriangle, Minus, Leaf, ChevronDown, ChevronUp } from 'lucide-svelte';
  import { bugReporter, submitReport, cancelReport } from '$lib/state/ui/bug-reporter.svelte';

  let dialogEl: HTMLDialogElement | undefined = $state();

  const isOpen = $derived(bugReporter.phase === 'previewing');
  const showFlash = $derived(bugReporter.flashVisible);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      cancelReport();
    }
  }

  function openScreenshotDialog() {
    dialogEl?.showModal();
  }

  function closeScreenshotDialog() {
    dialogEl?.close();
  }

  const severityOptions = [
    { value: 'critical' as const, label: 'Critical', Icon: Flame, color: 'text-destructive' },
    { value: 'high' as const, label: 'High', Icon: AlertTriangle, color: 'text-warning' },
    { value: 'medium' as const, label: 'Medium', Icon: Minus, color: 'text-accent' },
    { value: 'low' as const, label: 'Low', Icon: Leaf, color: 'text-success' },
  ] as const;

  const logLevelDot: Record<string, string> = {
    error: 'bg-destructive',
    warn: 'bg-warning',
    info: 'bg-accent',
    log: 'bg-muted-foreground',
  };
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Camera flash overlay -->
{#if showFlash}
  <div
    data-no-capture
    class="fixed inset-0 z-[10001] pointer-events-none"
    style="background: rgb(255, 252, 240); animation: camera-flash 320ms ease-out forwards;"
  ></div>
{/if}

<!-- Card overlay -->
{#if isOpen}
  <!-- Backdrop (click to close) -->
  <button
    data-no-capture
    class="fixed inset-0 z-[9999] cursor-default"
    onclick={cancelReport}
    aria-label="Close bug reporter"
    tabindex="-1"
  ></button>

  <div
    data-no-capture
    class="fixed bottom-5 right-5 z-[10000] w-[420px] max-sm:left-3 max-sm:right-3 max-sm:w-auto bg-bg2 border border-border rounded-xl shadow-lg overflow-hidden"
    style="animation: card-expand 200ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;"
    role="dialog"
    aria-modal="true"
    aria-label="Bug report"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border">
      <h3 class="text-sm font-semibold text-foreground">Report a Bug</h3>
      <button onclick={cancelReport} class="text-muted hover:text-foreground transition-colors" aria-label="Close">
        <X size={16} />
      </button>
    </div>

    <div class="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
      <!-- Screenshot thumbnail -->
      {#if bugReporter.screenshotDataUrl}
        <button
          onclick={openScreenshotDialog}
          class="w-full aspect-video rounded-lg overflow-hidden border border-border hover:border-accent/40 transition-colors cursor-pointer"
        >
          <img
            src={bugReporter.screenshotDataUrl}
            alt="Screenshot preview"
            class="w-full h-full object-cover"
          />
        </button>
      {:else}
        <div class="w-full aspect-video rounded-lg border border-border bg-bg3 flex items-center justify-center text-muted-foreground text-xs">
          No screenshot captured
        </div>
      {/if}

      <!-- Console logs (collapsible) -->
      {#if bugReporter.consoleLogs.length > 0}
        <div class="border border-border rounded-lg overflow-hidden">
          <button
            onclick={() => (bugReporter.logsCollapsed = !bugReporter.logsCollapsed)}
            class="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors"
          >
            <span>Console Logs ({bugReporter.consoleLogs.length})</span>
            {#if bugReporter.logsCollapsed}
              <ChevronDown size={14} />
            {:else}
              <ChevronUp size={14} />
            {/if}
          </button>

          {#if !bugReporter.logsCollapsed}
            <div class="max-h-40 overflow-y-auto border-t border-border" role="log">
              {#each bugReporter.consoleLogs.slice(-30) as entry}
                <div class="flex items-start gap-2 px-3 py-1 text-[11px] font-mono text-muted hover:bg-bg3/50">
                  <span class="shrink-0 mt-1 w-2 h-2 rounded-full {logLevelDot[entry.level] ?? 'bg-muted-foreground'}"></span>
                  <span class="truncate">{entry.message}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Severity picker -->
      <div role="radiogroup" aria-label="Bug severity">
        <p class="text-xs text-muted mb-2">Severity</p>
        <div class="grid grid-cols-4 gap-1.5">
          {#each severityOptions as opt}
            <button
              onclick={() => (bugReporter.severity = opt.value)}
              class="flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-xs transition-all duration-150
                {bugReporter.severity === opt.value
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-border text-muted hover:border-border hover:text-foreground hover:bg-bg3'}"
              role="radio"
              aria-checked={bugReporter.severity === opt.value}
            >
              <opt.Icon size={16} class={opt.color} />
              <span>{opt.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Comment textarea -->
      <div>
        <label for="bug-comment" class="text-xs text-muted block mb-1.5">What happened?</label>
        <textarea
          id="bug-comment"
          bind:value={bugReporter.comment}
          placeholder="Describe what went wrong..."
          rows={3}
          class="w-full px-3 py-2 text-sm bg-bg border border-border rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent/50 resize-none"
        ></textarea>
      </div>
    </div>

    <!-- Action row -->
    <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
      <button
        onclick={cancelReport}
        class="px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors rounded-md"
      >
        Cancel
      </button>
      <button
        onclick={() => submitReport()}
        class="px-4 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded-md hover:bg-accent/90 transition-colors"
      >
        Submit
      </button>
    </div>
  </div>
{/if}

<!-- Full-size screenshot dialog -->
<dialog
  bind:this={dialogEl}
  class="max-w-[90vw] max-h-[90vh] p-0 bg-transparent backdrop:bg-black/70 rounded-xl"
  onclick={(e) => { if (e.target === dialogEl) closeScreenshotDialog(); }}
>
  {#if bugReporter.screenshotDataUrl}
    <img
      src={bugReporter.screenshotDataUrl}
      alt="Full screenshot"
      class="max-w-full max-h-[90vh] rounded-xl"
    />
  {/if}
</dialog>
