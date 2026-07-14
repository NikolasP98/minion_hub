<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { readBuildStream, type BuildProgress } from './read-build-stream';

  interface Props {
    open?: boolean;
    artifactId: string;
    ondone?: () => void;
  }

  let { open = $bindable(false), artifactId, ondone }: Props = $props();

  let refinement = $state('');
  let generating = $state(false);
  let errorMsg = $state('');
  let progress = $state<BuildProgress | null>(null);

  const canSubmit = $derived(refinement.trim().length > 0);
  const progressLabel = $derived(
    progress
      ? progress.phase === 'repairing'
        ? m.artifact_build_repairing({ attempt: progress.attempt, max: progress.max })
        : m.artifact_build_generating({ attempt: progress.attempt, max: progress.max })
      : m.artifact_regenerate_loading(),
  );

  function reset() {
    refinement = '';
    generating = false;
    errorMsg = '';
    progress = null;
  }

  async function handleSubmit() {
    if (!canSubmit || generating) return;
    generating = true;
    errorMsg = '';
    progress = null;
    try {
      const res = await fetch(`/api/artifacts/${artifactId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refinement: refinement.trim() }),
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
      await readBuildStream(res, (p) => (progress = p));
      ondone?.();
      open = false;
      reset();
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      generating = false;
      progress = null;
    }
  }
</script>

<Modal bind:open title={m.artifact_regenerate()} onclose={reset}>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <label class="text-xs font-medium text-muted" for="arm-refinement">
        {m.artifact_regenerate_prompt()}
      </label>
      <textarea
        id="arm-refinement"
        bind:value={refinement}
        rows={4}
        disabled={generating}
        class="w-full rounded-lg border border-border bg-foreground/[0.04] px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-foreground/30 focus:ring-0 resize-y disabled:opacity-50"
        placeholder={m.artifact_regenerate_prompt()}></textarea>
    </div>

    {#if errorMsg}
      <p class="text-xs text-[var(--color-danger-fg)]">{errorMsg}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button
      variant="ghost"
      type="button"
      onclick={handleSubmit}
      disabled={!canSubmit || generating}
      class="flex items-center gap-2 rounded-lg bg-foreground/10 px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {#if generating}
        <Spinner size="xs" />
        {progressLabel}
      {:else}
        {m.artifact_regenerate()}
      {/if}
    </Button>
  {/snippet}
</Modal>
