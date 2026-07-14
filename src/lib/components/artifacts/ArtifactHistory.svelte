<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';

  interface RevisionRow {
    id: string;
    version: number;
    prompt: string | null;
    createdAt: string;
  }

  interface Props {
    open?: boolean;
    artifactId: string;
    onreverted?: () => void;
  }

  let { open = $bindable(false), artifactId, onreverted }: Props = $props();

  let rows = $state<RevisionRow[]>([]);
  let loading = $state(false);
  let revertingId = $state<string | null>(null);
  let errorMsg = $state('');

  async function fetchRevisions() {
    loading = true;
    errorMsg = '';
    try {
      const res = await fetch(`/api/artifacts/${artifactId}/revisions`);
      if (!res.ok) {
        errorMsg = `Error ${res.status}`;
        return;
      }
      rows = (await res.json()) as RevisionRow[];
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  async function handleRevert(revisionId: string) {
    if (revertingId) return;
    revertingId = revisionId;
    errorMsg = '';
    try {
      const res = await fetch(`/api/artifacts/${artifactId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId }),
      });
      if (!res.ok) {
        let msg: string;
        try {
          const body = await res.json();
          msg =
            (body as { message?: string; error?: string }).message ??
            (body as { message?: string; error?: string }).error ??
            `Error ${res.status}`;
        } catch {
          msg = `Error ${res.status}`;
        }
        errorMsg = msg;
        return;
      }
      onreverted?.();
      await fetchRevisions();
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      revertingId = null;
    }
  }

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  $effect(() => {
    if (open) {
      fetchRevisions();
    }
  });
</script>

<Modal bind:open title={m.artifact_history()} size="md">
  <div class="flex flex-col gap-3 min-h-[8rem]">
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    {:else if errorMsg}
      <p class="text-xs text-[var(--color-danger-fg)]">{errorMsg}</p>
    {:else if rows.length === 0}
      <p class="py-6 text-center text-sm text-foreground/40">{m.artifact_history_empty()}</p>
    {:else}
      {#each rows as r (r.id)}
        <div
          class="flex items-center gap-3 rounded-lg border border-border bg-foreground/[0.03] px-3 py-2"
        >
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-foreground/80">
              {m.artifact_version({ n: r.version })}
            </p>
            {#if r.prompt}
              <p class="mt-0.5 truncate text-[length:var(--font-size-caption)] text-foreground/50">
                {r.prompt}
              </p>
            {/if}
            <p class="mt-0.5 text-[length:var(--font-size-telemetry)] text-foreground/35">
              {relativeTime(r.createdAt)}
            </p>
          </div>
          <Button
            variant="ghost"
            type="button"
            onclick={() => handleRevert(r.id)}
            disabled={!!revertingId}
            class="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-foreground/5 px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {#if revertingId === r.id}
              <Spinner size="xs" />
            {/if}
            {m.artifact_revert()}
          </Button>
        </div>
      {/each}
    {/if}
  </div>
</Modal>
