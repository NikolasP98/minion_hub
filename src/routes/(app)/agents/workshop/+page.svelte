<script lang="ts">
  import { goto } from '$lib/navigation';
  import { recordHref, recordPathSegment } from '$lib/utils/record-path';
  import { onMount } from 'svelte';

  import * as m from '$lib/paraglide/messages';
  import { Button, PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import {
    listWorkspaceSaves,
    createBlankSave,
    openSave,
    deleteWorkspaceSave,
    persistActiveSaveId,
  } from '$lib/state/workshop/workshop.svelte';

  type SaveMeta = {
    id: string;
    name: string;
    updatedAt: number;
    thumbnail: string | null;
    agentCount: number;
    elementCount: number;
  };

  let saves = $state<SaveMeta[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  /** One create/open/delete admitted at a time: `'create'` or the save id in flight. */
  let busy = $state<string | null>(null);

  async function loadSaves() {
    loading = true;
    loadError = null;
    try {
      saves = await listWorkspaceSaves();
    } catch (error) {
      loadError = error instanceof Error ? error.message : m.common_error();
    } finally {
      loading = false;
    }
  }

  onMount(loadSaves);

  async function handleCreateBlank() {
    if (busy) return;
    busy = 'create';
    try {
      const name = `Workspace ${new Date().toLocaleDateString()}`;
      const id = await createBlankSave(name);
      if (id) goto(`/agents/workshop/${recordPathSegment(id)}`);
    } catch {
      toastError(m.workshop_createFailed());
    } finally {
      busy = null;
    }
  }

  async function handleOpen(id: string) {
    busy = id;
    try {
      // Only the completion that published may persist the selection and navigate.
      if (await openSave(id)) {
        persistActiveSaveId(id);
        goto(`/agents/workshop/${recordPathSegment(id)}`);
      }
    } catch {
      toastError(m.workshop_openFailed());
    } finally {
      if (busy === id) busy = null;
    }
  }

  async function handleDelete(id: string) {
    if (busy) return;
    busy = id;
    try {
      await deleteWorkspaceSave(id);
      saves = saves.filter((s) => s.id !== id);
    } catch {
      toastError(m.workshop_deleteFailed());
    } finally {
      busy = null;
    }
  }

  const pageState = $derived(
    loading
      ? { kind: 'loading' as const }
      : loadError
        ? { kind: 'error' as const, description: loadError, retry: loadSaves }
        : saves.length === 0
          ? { kind: 'empty' as const, title: m.workshop_noSaves() }
          : { kind: 'ready' as const },
  );
</script>

<PageShell archetype="collection" scroll="region" variant="canvas" labelledBy="workshop-list-title">
  <PageHeader title={m.nav_workshop()} titleId="workshop-list-title">
    {#snippet primaryActions()}
      <Button
        type="button"
        variant="primary"
        size="touch"
        loading={busy === 'create'}
        onclick={handleCreateBlank}>{m.workshop_createBlank()}</Button
      >
    {/snippet}
  </PageHeader>
  <PageBody width="content" scroll="region">
    <AsyncBoundary state={pageState}>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {#each saves as save (save.id)}
          <div
            class="workspace-card group rounded border border-border bg-bg2 hover:border-accent/50 transition-colors"
          >
            <Button
              variant="ghost"
              type="button"
              class="workspace-open"
              aria-label={save.name}
              disabled={!recordHref('/agents/workshop', save.id) || busy === save.id}
              onclick={() => handleOpen(save.id)}
            >
              <!-- Thumbnail / placeholder -->
              <span class="block aspect-video bg-bg3 overflow-hidden">
                {#if save.thumbnail}
                  <img src={save.thumbnail} alt="" class="w-full h-full object-cover" />
                {:else}
                  <span
                    class="w-full h-full flex items-center justify-center text-muted-strong text-2xl select-none"
                  >
                    ⬡
                  </span>
                {/if}
              </span>
              <!-- Metadata footer -->
              <span class="workspace-footer p-2.5 flex items-start justify-between gap-2">
                <span class="block min-w-0">
                  <span class="block font-mono text-xs text-foreground truncate">{save.name}</span>
                  <span class="block font-mono text-xs text-muted mt-0.5">
                    {m.workshop_agentElementCount({
                      agents: save.agentCount,
                      elements: save.elementCount,
                    })}
                  </span>
                  <span class="block font-mono text-xs text-muted-strong mt-0.5">
                    {new Date(save.updatedAt).toLocaleDateString()}
                  </span>
                </span>
              </span>
            </Button>
            <Button
              variant="danger"
              type="button"
              size="touch"
              shape="icon"
              disabled={busy === save.id}
              onclick={() => handleDelete(save.id)}
              class="workspace-delete"
              aria-label={`${m.common_delete()} ${save.name}`}>×</Button
            >
          </div>
        {/each}
      </div>
      {#snippet emptyAction()}
        <Button
          type="button"
          variant="primary"
          size="touch"
          loading={busy === 'create'}
          onclick={handleCreateBlank}>{m.workshop_createBlank()}</Button
        >
      {/snippet}
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  .workspace-card {
    position: relative;
    min-width: 0;
  }
  .workspace-card :global(.workspace-open) {
    display: block;
    width: 100%;
    height: auto;
    padding: 0;
    text-align: left;
    overflow: hidden;
  }
  .workspace-card :global(.workspace-open > span) {
    display: block;
    width: 100%;
    height: auto;
  }
  .workspace-footer {
    padding-right: calc(var(--control-height-touch) + var(--space-4));
  }
  .workspace-card :global(.workspace-delete) {
    position: absolute;
    bottom: var(--space-2);
    right: var(--space-2);
    min-height: var(--control-height-touch);
    min-width: var(--control-height-touch);
    opacity: 0;
  }
  .workspace-card:hover :global(.workspace-delete),
  .workspace-card:focus-within :global(.workspace-delete) {
    opacity: 1;
  }
  @media (hover: none), (pointer: coarse) {
    .workspace-card :global(.workspace-delete) {
      opacity: 1;
    }
  }
</style>
