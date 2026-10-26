<script lang="ts">
  import type { PageData } from './$types';
  import { ArrowLeft, Copy, DoorOpen, ExternalLink } from 'lucide-svelte';
  import { invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, Button, Input, PageHeader, Toggle } from '$lib/components/ui';
  import { FormField, PageBody, PageShell } from '$lib/components/ui/foundations';
  import { canAct } from '$lib/access/can.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { localizePath } from '$lib/canonical-path';
  import { doorKindLabel } from '$lib/doors/labels';
  import { loadDoorEditor, loadDoorPanels } from '$lib/components/doors/registry';
  import type { DoorRow } from '$lib/doors/types';

  let { data }: { data: PageData } = $props();

  const canManage = $derived(canAct('crm', 'manage'));

  type Draft = Pick<DoorRow, 'title' | 'description' | 'slug' | 'active' | 'config'>;
  const snapshot = (d: DoorRow): Draft => ({
    title: d.title,
    description: d.description,
    slug: d.slug,
    active: d.active,
    config: d.config,
  });
  // svelte-ignore state_referenced_locally
  let committed = $state<Draft>(snapshot(data.door));
  // svelte-ignore state_referenced_locally
  let draft = $state<Draft>(snapshot(data.door));
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  // A different door (client navigation between ids) re-seeds the editor.
  // svelte-ignore state_referenced_locally
  let seededId = $state(data.door.id);
  $effect(() => {
    if (data.door.id !== seededId) {
      seededId = data.door.id;
      committed = snapshot(data.door);
      draft = snapshot(data.door);
      saveError = null;
    }
  });

  const changed = $derived(
    (Object.keys(draft) as Array<keyof Draft>).filter(
      (key) => JSON.stringify(draft[key]) !== JSON.stringify(committed[key]),
    ),
  );
  const publicPath = $derived(localizePath(`/d/${committed.slug}`));

  async function save() {
    if (!canManage || saving || changed.length === 0) return;
    saving = true;
    saveError = null;
    const patch = Object.fromEntries(changed.map((key) => [key, draft[key]]));
    try {
      const res = await fetch(`/api/crm/doors/${encodeURIComponent(data.door.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        saveError =
          res.status === 403
            ? m.doors_no_permission()
            : res.status === 409
              ? m.doors_slug_taken()
              : res.status === 400
                ? body.error === 'unknown_kind'
                  ? m.doors_unknown_kind()
                  : m.doors_invalid()
                : m.doors_save_error();
        return;
      }
      const { door } = (await res.json()) as { door: DoorRow };
      committed = snapshot(door);
      draft = snapshot(door);
      toastSuccess(m.doors_saved());
      await invalidate('crm:doors');
    } catch {
      saveError = m.doors_save_error();
    } finally {
      saving = false;
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${data.origin}${publicPath}`);
      toastSuccess(m.doors_copied());
    } catch {
      toastError(m.doors_save_error());
    }
  }
</script>

<svelte:head><title>{committed.title} · {m.doors_title()}</title></svelte:head>

<PageShell archetype="record-detail" scroll="region" labelledBy="crm-door-title">
  <PageHeader
    titleId="crm-door-title"
    title={committed.title}
    subtitle={doorKindLabel(data.door.kind)}
  >
    {#snippet leading()}
      <a class="back" href="/crm/doors" aria-label={m.doors_back()}>
        <ArrowLeft size={iconSizes.md} />
      </a>
    {/snippet}
    {#snippet primaryActions()}
      {#if canManage}
        <Button size="sm" onclick={save} loading={saving} disabled={changed.length === 0}>
          {m.doors_save()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="door-body">
    {#if !canManage}
      <p class="t-caption muted">{m.doors_read_only()}</p>
    {/if}
    {#if saveError}
      <p class="save-error" role="alert">{saveError}</p>
    {/if}

    <section class="card" aria-labelledby="door-general">
      <div class="card-h" id="door-general">
        <span><DoorOpen size={iconSizes.sm} /> {doorKindLabel(data.door.kind)}</span>
      </div>
      <div class="fields">
        <FormField label={m.doors_field_title()} required disabled={!canManage || saving}>
          {#snippet children(p)}<Input {...p} bind:value={draft.title} maxlength={200} />{/snippet}
        </FormField>
        <FormField
          label={m.doors_field_slug()}
          helper={m.doors_slug_hint()}
          required
          disabled={!canManage || saving}
        >
          {#snippet children(p)}<Input {...p} bind:value={draft.slug} maxlength={63} />{/snippet}
        </FormField>
        <FormField label={m.doors_field_description()} disabled={!canManage || saving}>
          {#snippet children(p)}<Input
              {...p}
              value={draft.description ?? ''}
              maxlength={2000}
              oninput={(e: Event) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                draft.description = v.trim() ? v : null;
              }}
            />{/snippet}
        </FormField>
        <Toggle
          checked={draft.active}
          disabled={!canManage || saving}
          label={m.doors_field_active()}
          description={m.doors_active_hint()}
          onchange={(checked) => (draft.active = checked)}
        />
        <div class="public-link">
          <span class="slug">{publicPath}</span>
          <Button
            variant="ghost"
            shape="icon"
            size="xs"
            onclick={copyLink}
            aria-label={m.doors_copy()}
          >
            <Copy size={iconSizes.sm} />
          </Button>
          <a
            class="open"
            href={publicPath}
            target="_blank"
            rel="noopener"
            aria-label={m.doors_open()}
          >
            <ExternalLink size={iconSizes.sm} />
          </a>
        </div>
      </div>
    </section>

    {#await loadDoorEditor(data.door.kind) then Editor}
      <section class="card">
        {#if Editor}
          <Editor
            config={draft.config}
            onchange={(config) => (draft.config = config)}
            canManage={canManage && !saving}
          />
        {:else}
          <p class="t-body muted">{m.doors_editor_unavailable()}</p>
        {/if}
      </section>
    {/await}

    {#await loadDoorPanels(data.door.kind) then panels}
      {#each panels as Panel, i (i)}
        <Panel door={data.door} {canManage} />
      {/each}
    {/await}
  </PageBody>
</PageShell>

<style>
  :global(.door-body) {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .back {
    display: inline-flex;
    color: var(--color-text-secondary);
  }
  .back:hover {
    color: var(--color-accent);
  }
  .card {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-card);
  }
  .card-h {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    text-transform: uppercase;
    font-size: var(--font-size-caption);
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }
  .card-h span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .public-link {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .slug {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .open {
    display: inline-flex;
    color: var(--color-text-secondary);
  }
  .open:hover {
    color: var(--color-accent);
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .save-error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
  }
</style>
