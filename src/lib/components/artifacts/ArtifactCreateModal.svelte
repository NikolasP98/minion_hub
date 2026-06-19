<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import Modal from '$lib/components/ui/Modal.svelte';

  interface Props {
    open?: boolean;
    agentId: string;
    oncreated?: () => void;
  }

  let { open = $bindable(false), agentId, oncreated }: Props = $props();

  const ICON_OPTIONS = [
    'LayoutDashboard',
    'BarChart3',
    'Activity',
    'Megaphone',
    'Bell',
    'Gauge',
    'LineChart',
    'Table',
  ] as const;

  let title = $state('');
  let description = $state('');
  let icon = $state<string>('LayoutDashboard');
  let html = $state('');
  let error = $state('');
  let loading = $state(false);

  const canSubmit = $derived(title.trim().length > 0 && html.trim().length > 0);

  function reset() {
    title = '';
    description = '';
    icon = 'LayoutDashboard';
    html = '';
    error = '';
    loading = false;
  }

  async function handleCreate() {
    if (!canSubmit || loading) return;
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, title: title.trim(), description: description.trim(), icon, html }),
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
</script>

<Modal bind:open title={m.artifact_create_title()}>
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="acm-title">
          {m.artifact_create_name()}
        </label>
        <input
          id="acm-title"
          type="text"
          bind:value={title}
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
          placeholder={m.artifact_create_name()}
          autocomplete="off"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="acm-desc">
          {m.artifact_create_desc()}
        </label>
        <input
          id="acm-desc"
          type="text"
          bind:value={description}
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0"
          placeholder={m.artifact_create_desc()}
          autocomplete="off"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="acm-icon">
          {m.artifact_create_icon()}
        </label>
        <select
          id="acm-icon"
          bind:value={icon}
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white outline-none focus:border-white/30"
        >
          {#each ICON_OPTIONS as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-white/70" for="acm-html">
          {m.artifact_create_html()}
        </label>
        <textarea
          id="acm-html"
          bind:value={html}
          rows={8}
          class="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-xs text-white placeholder-white/30 outline-none focus:border-white/30 focus:ring-0 resize-y"
          placeholder="<!DOCTYPE html>..."
        ></textarea>
        <p class="text-[11px] leading-snug text-white/45">{m.artifact_create_html_hint()}</p>
      </div>

      {#if error}
        <p class="text-xs text-red-400">{error}</p>
      {/if}
    </div>

  {#snippet footer()}
    <button
      type="button"
      onclick={handleCreate}
      disabled={!canSubmit || loading}
      class="rounded-lg bg-white/10 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {m.artifact_create_submit()}
    </button>
  {/snippet}
</Modal>
