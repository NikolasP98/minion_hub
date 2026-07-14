<script lang="ts">
  // Reusable activity timeline — comments + field-audit, merged chronologically.
  // Works for any record: pass the loaded `items` + an `onComment` callback.
  import type { TimelineItem } from '$server/services/activity.service';
  import { MessageSquare, GitCommit } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';
  import { relativeTime } from '$lib/components/crm/crm-format';

  let {
    items,
    onComment,
  }: { items: TimelineItem[]; onComment: (body: string) => Promise<void> | void } = $props();

  let draft = $state('');
  let busy = $state(false);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    busy = true;
    try {
      await onComment(body);
      draft = '';
    } finally {
      busy = false;
    }
  }

  function changeText(changes: TimelineItem['changes']): string {
    return (changes ?? [])
      .slice(0, 3)
      .map((c) => `${c.label}: ${c.old ?? '—'} → ${c.new ?? '—'}`)
      .join(', ');
  }
</script>

<div class="timeline">
  <div class="composer">
    <input
      class="inp"
      bind:value={draft}
      placeholder="Add a comment…"
      onkeydown={(e) => e.key === 'Enter' && submit()}
    />
    <Button variant="secondary" size="sm" onclick={submit} disabled={busy || !draft.trim()}
      >Comment</Button
    >
  </div>

  <ol class="feed">
    {#each items as it (it.id)}
      <li class="item" class:audit={it.src === 'audit'}>
        {#if it.src === 'comment'}
          <MessageSquare size={13} class="ic" />
          <div class="bubble">
            <div class="meta">
              <span class="who">{it.actorName ?? 'System'}</span><span class="ts"
                >{relativeTime(it.ts)}</span
              >
            </div>
            <p class="body">{it.body}</p>
          </div>
        {:else}
          <GitCommit size={12} class="ic muted" />
          <span class="audit-line">
            <strong>{it.actorName ?? 'System'}</strong>
            {changeText(it.changes)}
            <span class="ts">· {relativeTime(it.ts)}</span>
          </span>
        {/if}
      </li>
    {:else}
      <li class="t-caption empty">No activity yet.</li>
    {/each}
  </ol>
</div>

<style>
  .composer {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .inp {
    flex: 1;
    height: 2rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
  }
  .feed {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .item {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .item :global(.ic) {
    margin-top: var(--space-1);
    color: var(--color-muted-foreground);
    flex-shrink: 0;
  }
  .item :global(.ic.muted) {
    opacity: 0.6;
  }
  .bubble {
    flex: 1;
    min-width: 0;
  }
  .meta {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
  }
  .who {
    font-size: var(--font-size-body);
    font-weight: 600;
  }
  .ts {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
  }
  .body {
    font-size: var(--font-size-body);
    white-space: pre-wrap;
    margin-top: var(--space-0-5);
  }
  .audit-line {
    font-size: var(--font-size-body);
    color: var(--color-muted-foreground);
  }
  .audit-line strong {
    color: var(--color-foreground);
    font-weight: 600;
  }
  .empty {
    padding: var(--space-2) 0;
  }
</style>
