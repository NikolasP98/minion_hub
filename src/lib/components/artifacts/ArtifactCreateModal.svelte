<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import NoteIconButton from '$lib/components/my-agent/NoteIconButton.svelte';
  import { readBuildStream, type BuildProgress } from './read-build-stream';

  interface Props {
    open?: boolean;
    agentId: string;
    oncreated?: () => void;
  }

  let { open = $bindable(false), agentId, oncreated }: Props = $props();

  const DEFAULT_ICON = 'lucide:LayoutDashboard';

  let mode = $state<'generate' | 'paste'>('generate');
  let title = $state('');
  let description = $state('');
  let icon = $state<string>(DEFAULT_ICON);
  let html = $state('');
  let prompt = $state('');
  let error = $state('');
  let loading = $state(false);
  let generating = $state(false);
  let progress = $state<BuildProgress | null>(null);

  const canSubmitPaste = $derived(title.trim().length > 0 && html.trim().length > 0);
  const canSubmitGenerate = $derived(title.trim().length > 0 && prompt.trim().length > 0);
  const progressLabel = $derived(
    progress
      ? progress.phase === 'repairing'
        ? m.artifact_build_repairing({ attempt: progress.attempt, max: progress.max })
        : m.artifact_build_generating({ attempt: progress.attempt, max: progress.max })
      : m.artifact_gen_loading(),
  );

  function reset() {
    title = '';
    description = '';
    icon = DEFAULT_ICON;
    html = '';
    prompt = '';
    error = '';
    loading = false;
    generating = false;
    progress = null;
  }

  async function handleCreate() {
    if (!canSubmitPaste || loading) return;
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          title: title.trim(),
          description: description.trim(),
          icon,
          html,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = (body as { error?: string }).error ?? `Error ${res.status}`;
        return;
      }
      oncreated?.();
      open = false;
      reset();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  async function handleGenerate() {
    if (!canSubmitGenerate || generating) return;
    generating = true;
    error = '';
    progress = null;
    try {
      const res = await fetch('/api/artifacts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          title: title.trim(),
          icon,
          description: description.trim(),
          prompt: prompt.trim(),
        }),
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
        error = msg;
        return;
      }
      await readBuildStream(res, (p) => (progress = p));
      oncreated?.();
      open = false;
      reset();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      generating = false;
      progress = null;
    }
  }
</script>

<Modal bind:open title={m.artifact_create_title()}>
  {#snippet header()}
    <div class="flex items-center gap-2.5">
      <NoteIconButton {icon} onpick={(v) => (icon = v || DEFAULT_ICON)} size={20} />
      <input
        type="text"
        bind:value={title}
        placeholder={m.artifact_create_title()}
        aria-label={m.artifact_create_name()}
        autocomplete="off"
        class="t-heading min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground outline-none placeholder:text-foreground/30 focus:ring-0"
      />
    </div>
  {/snippet}

  <div class="flex flex-col gap-4">
    <!-- Tab switch -->
    <div class="flex rounded-lg border border-border bg-foreground/[0.04] p-0.5">
      <Button
        variant="ghost"
        type="button"
        onclick={() => {
          mode = 'generate';
          error = '';
        }}
        class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {mode ===
        'generate'
          ? 'bg-foreground/15 text-foreground'
          : 'text-foreground/50 hover:text-foreground/80'}"
      >
        {m.artifact_gen_tab()}
      </Button>
      <Button
        variant="ghost"
        type="button"
        onclick={() => {
          mode = 'paste';
          error = '';
        }}
        class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {mode === 'paste'
          ? 'bg-foreground/15 text-foreground'
          : 'text-foreground/50 hover:text-foreground/80'}"
      >
        {m.artifact_paste_tab()}
      </Button>
    </div>

    <!-- Shared: description -->
    <div class="flex flex-col gap-1.5">
      <label class="text-xs font-medium text-muted" for="acm-desc">
        {m.artifact_create_desc()}
      </label>
      <input
        id="acm-desc"
        type="text"
        bind:value={description}
        class="w-full rounded-lg border border-border bg-foreground/[0.04] px-3 py-1.5 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-foreground/30 focus:ring-0"
        placeholder={m.artifact_create_desc()}
        autocomplete="off"
      />
    </div>

    <!-- Generate tab: prompt textarea -->
    {#if mode === 'generate'}
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-muted" for="acm-prompt">
          {m.artifact_gen_prompt()}
        </label>
        <textarea
          id="acm-prompt"
          bind:value={prompt}
          rows={5}
          class="w-full rounded-lg border border-border bg-foreground/[0.04] px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-foreground/30 focus:ring-0 resize-y"
          placeholder={m.artifact_gen_prompt_ph()}></textarea>
      </div>
    {/if}

    <!-- Paste tab: HTML textarea -->
    {#if mode === 'paste'}
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-muted" for="acm-html">
          {m.artifact_create_html()}
        </label>
        <textarea
          id="acm-html"
          bind:value={html}
          rows={8}
          class="w-full rounded-lg border border-border bg-foreground/[0.04] px-3 py-2 font-mono text-xs text-foreground placeholder:text-foreground/30 outline-none focus:border-foreground/30 focus:ring-0 resize-y"
          placeholder="<!DOCTYPE html>..."></textarea>
        <p class="text-[length:var(--font-size-caption)] leading-snug text-foreground/45">
          {m.artifact_create_html_hint()}
        </p>
      </div>
    {/if}

    {#if error}
      <p class="text-xs text-[var(--color-danger-fg)]">{error}</p>
    {/if}
  </div>

  {#snippet footer()}
    {#if mode === 'generate'}
      <Button
        variant="ghost"
        type="button"
        onclick={handleGenerate}
        disabled={!canSubmitGenerate || generating}
        class="flex items-center gap-2 rounded-lg bg-foreground/10 px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {#if generating}
          <Spinner size="xs" />
          {progressLabel}
        {:else}
          {m.artifact_gen_submit()}
        {/if}
      </Button>
    {:else}
      <Button
        variant="ghost"
        type="button"
        onclick={handleCreate}
        disabled={!canSubmitPaste || loading}
        class="rounded-lg bg-foreground/10 px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {m.artifact_create_submit()}
      </Button>
    {/if}
  {/snippet}
</Modal>
