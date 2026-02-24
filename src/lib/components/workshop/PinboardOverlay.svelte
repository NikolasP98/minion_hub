<script lang="ts">
  import {
    workshopState,
    addPinboardItem,
    removePinboardItem,
    votePinboardItem,
    addPinboardComment,
  } from '$lib/state/workshop.svelte';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let newPinContent = $state('');
  let expandedComments = $state<Record<string, boolean>>({});
  let newCommentText = $state<Record<string, string>>({});

  let element = $derived(workshopState.elements[elementId]);

  // Sort pins by net score descending
  let pins = $derived(
    [...(element?.pinboardItems ?? [])].sort((a, b) => {
      const na = a.upvotes.length - a.downvotes.length;
      const nb = b.upvotes.length - b.downvotes.length;
      return nb - na;
    })
  );

  function handleAdd() {
    const trimmed = newPinContent.trim();
    if (!trimmed) return;
    addPinboardItem(elementId, trimmed, 'user');
    newPinContent = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  }

  function handleCommentKeydown(e: KeyboardEvent, pinId: string) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitComment(pinId);
    }
  }

  function submitComment(pinId: string) {
    const text = (newCommentText[pinId] ?? '').trim();
    if (!text) return;
    addPinboardComment(elementId, pinId, 'user', text);
    newCommentText[pinId] = '';
  }

  function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function getNetScore(pin: { upvotes: string[]; downvotes: string[] }): number {
    return pin.upvotes.length - pin.downvotes.length;
  }

  function getPinOpacity(net: number): string {
    if (net === -1) return 'opacity-80';
    if (net <= -2) return 'opacity-60';
    return '';
  }

  function getScoreColor(net: number): string {
    if (net > 0) return 'text-green-400';
    if (net < -1) return 'text-red-400';
    if (net < 0) return 'text-yellow-500';
    return 'text-muted';
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
  onclick={handleBackdropClick}
>
  <div class="w-full max-w-lg rounded-lg border border-border bg-bg2 shadow-xl">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <span class="text-[10px] font-mono text-foreground font-semibold">
        Pinboard — {element?.label ?? ''}
        <span class="text-muted font-normal ml-1">({pins.length} pins)</span>
      </span>
      <button
        class="text-[10px] font-mono text-muted hover:text-foreground"
        onclick={onClose}
      >
        x
      </button>
    </div>

    <!-- Pin list -->
    <div class="max-h-[400px] overflow-y-auto p-3 space-y-2">
      {#each pins as pin (pin.id)}
        {@const net = getNetScore(pin)}
        {@const isWarning = net === -2}
        <div class="rounded border border-border bg-bg3 p-2 {getPinOpacity(net)}">
          <div class="flex items-start gap-2">
            <!-- Vote buttons -->
            <div class="flex flex-col items-center gap-0.5 shrink-0">
              <button
                class="text-[10px] font-mono text-muted hover:text-green-400 leading-none"
                onclick={() => votePinboardItem(elementId, pin.id, 'user', 'up')}
                title="Upvote"
              >▲</button>
              <span class="text-[9px] font-mono {getScoreColor(net)} leading-none">{net > 0 ? '+' : ''}{net}</span>
              <button
                class="text-[10px] font-mono text-muted hover:text-red-400 leading-none"
                onclick={() => votePinboardItem(elementId, pin.id, 'user', 'down')}
                title="Downvote"
              >▼</button>
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-start gap-1">
                <div class="flex-1 text-[10px] font-mono text-foreground break-words">{pin.content}</div>
                {#if isWarning}
                  <span class="shrink-0 text-[9px]" title="Low score — flagged">⚠️</span>
                {/if}
                <button
                  class="shrink-0 text-[10px] font-mono text-muted hover:text-foreground ml-1"
                  onclick={() => removePinboardItem(elementId, pin.id)}
                  title="Remove pin"
                >x</button>
              </div>

              <div class="mt-0.5 flex items-center gap-2 text-[9px] font-mono text-muted">
                <span>by {pin.pinnedBy} · {formatRelativeTime(pin.pinnedAt)}</span>
                <span>▲{pin.upvotes.length} ▼{pin.downvotes.length}</span>
                {#if pin.comments.length > 0}
                  <button
                    class="hover:text-foreground"
                    onclick={() => expandedComments[pin.id] = !expandedComments[pin.id]}
                  >
                    {expandedComments[pin.id] ? '▾' : '▸'} {pin.comments.length} comment{pin.comments.length !== 1 ? 's' : ''}
                  </button>
                {:else}
                  <button
                    class="hover:text-foreground"
                    onclick={() => expandedComments[pin.id] = !expandedComments[pin.id]}
                  >
                    {expandedComments[pin.id] ? '▾ hide' : '+ comment'}
                  </button>
                {/if}
              </div>

              <!-- Comments thread -->
              {#if expandedComments[pin.id]}
                <div class="mt-1.5 space-y-1 pl-2 border-l border-border">
                  {#each pin.comments as comment (comment.at)}
                    <div class="text-[9px] font-mono">
                      <span class="text-accent">{comment.authorId}</span>
                      <span class="text-muted ml-1">{formatRelativeTime(comment.at)}</span>
                      <div class="text-foreground/80 mt-0.5">{comment.text}</div>
                    </div>
                  {/each}
                  <div class="flex items-center gap-1 mt-1">
                    <input
                      type="text"
                      class="flex-1 rounded border border-border bg-bg px-1.5 py-0.5 text-[9px] font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
                      placeholder="Add comment..."
                      bind:value={newCommentText[pin.id]}
                      onkeydown={(e) => handleCommentKeydown(e, pin.id)}
                    />
                    <button
                      class="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-mono text-accent hover:bg-accent/20 disabled:opacity-40"
                      onclick={() => submitComment(pin.id)}
                      disabled={!(newCommentText[pin.id] ?? '').trim()}
                    >
                      Post
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {:else}
        <div class="text-center text-[10px] font-mono text-muted py-4">No pins yet</div>
      {/each}
    </div>

    <!-- Add pin -->
    <div class="flex items-center gap-2 border-t border-border px-3 py-2">
      <input
        type="text"
        class="flex-1 rounded border border-border bg-bg3 px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
        placeholder="Add a pin..."
        bind:value={newPinContent}
        onkeydown={handleKeydown}
      />
      <button
        class="shrink-0 rounded bg-accent/10 px-2 py-1 text-[10px] font-mono text-accent hover:bg-accent/20 disabled:opacity-40"
        onclick={handleAdd}
        disabled={!newPinContent.trim()}
      >
        Pin
      </button>
    </div>
  </div>
</div>
