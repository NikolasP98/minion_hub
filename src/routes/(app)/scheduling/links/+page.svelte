<script lang="ts">
  import type { PageData } from './$types';
  import { Link2, Plus, Trash2, Copy, ExternalLink } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Card, Button, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  let showNew = $state(false);
  let title = $state('');
  // Slug is derived from the title (view-only) — no manual entry, no redundancy.
  const slug = $derived(slugify(title));
  let chosen = $state<string[]>([]);
  let saving = $state(false);
  let copied = $state<string | null>(null);

  function publicUrl(s: string): string {
    return `${data.origin}/book/${s}`;
  }
  async function copy(s: string) {
    try {
      await navigator.clipboard.writeText(publicUrl(s));
      copied = s;
      setTimeout(() => (copied = copied === s ? null : copied), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  function toggle(id: string) {
    chosen = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
  }
  async function create() {
    if (!title.trim() || !slug.trim() || chosen.length === 0) return;
    saving = true;
    try {
      const res = await fetch('/api/scheduling/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, slug, eventTypeIds: chosen }),
      });
      if (res.ok) {
        showNew = false;
        title = '';
        chosen = [];
        await invalidate('scheduling:data');
      }
    } finally {
      saving = false;
    }
  }
  async function remove(id: string) {
    await fetch(`/api/scheduling/links/${id}`, { method: 'DELETE' });
    await invalidate('scheduling:data');
  }
</script>

<svelte:head><title>{m.sched_links_title()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="scheduling-links-title"
  class="scheduling-links-surface"
>
  <PageHeader
    titleId="scheduling-links-title"
    title={m.sched_links_title()}
    subtitle={m.sched_dashboard_subtitle()}
  >
    {#snippet leading()}
      <Link2 size={16} class="text-accent shrink-0" />
    {/snippet}
    {#snippet actions()}
      <Button
        size="sm"
        onclick={() => (showNew = !showNew)}
        disabled={data.eventTypes.length === 0 || !canAct('scheduling', 'edit')}
        title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
      >
        <Plus size={14} />
        {m.sched_link_new()}
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="flex flex-col gap-3">
    {#if showNew}
      <Card padding="lg">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label class="field">
            <span class="t-caption">{m.sched_link_title()}</span>
            <input class="txt" bind:value={title} />
          </label>
          <div class="field">
            <span class="t-caption">{m.sched_link_slug()}</span>
            <div class="txt slug-view" aria-readonly="true">{slug || '—'}</div>
          </div>
        </div>
        <div class="mt-3">
          <span class="t-caption">{m.sched_link_services()}</span>
          <div class="flex flex-wrap gap-2 mt-1">
            {#each data.eventTypes as e (e.id)}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="chip {chosen.includes(e.id) ? 'chip-on' : ''}"
                onclick={() => toggle(e.id)}
              >
                {e.title}
              </Button>
            {/each}
          </div>
          <p class="t-caption mt-1 opacity-70">{m.sched_link_team_note()}</p>
        </div>
        <div class="flex gap-2 mt-3">
          <Button
            onclick={create}
            disabled={saving || !title.trim() || !slug.trim() || chosen.length === 0}
          >
            {m.sched_save()}
          </Button>
          <Button variant="ghost" onclick={() => (showNew = false)}>{m.sched_cancel()}</Button>
        </div>
      </Card>
    {/if}

    {#if data.links.length === 0 && !showNew}
      <EmptyState title={m.sched_empty_links()} />
    {:else}
      {#each data.links as link (link.id)}
        <Card padding="md">
          <div class="flex items-center gap-3 flex-wrap">
            <div class="flex-1 min-w-[200px]">
              <div class="font-medium">{link.title}</div>
              <div class="t-caption truncate">{publicUrl(link.slug)}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="act"
              onclick={() => copy(link.slug)}
              title={m.sched_link_copy()}
            >
              <Copy size={15} />
              {copied === link.slug ? m.sched_link_copied() : ''}
            </Button>
            <a
              class="act"
              href={publicUrl(link.slug)}
              target="_blank"
              rel="noopener"
              title={m.sched_link_open()}
            >
              <ExternalLink size={15} />
            </a>
            {#if canAct('scheduling', 'delete')}
              <Button
                variant="ghost"
                size="sm"
                class="act del"
                onclick={() => remove(link.id)}
                title={m.sched_delete()}
              >
                <Trash2 size={15} />
              </Button>
            {/if}
          </div>
        </Card>
      {/each}
    {/if}
  </PageBody>
</PageShell>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }
  .txt {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: var(--space-2, 8px) var(--space-2, 8px);
    background: var(--color-card);
    font-size: var(--font-size-body, 14px);
    width: 100%;
  }
  .slug-view {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono, monospace);
    background: transparent;
    user-select: all;
  }
  .chip {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-full);
    padding: var(--space-1, 4px) var(--space-3, 12px);
    font-size: var(--font-size-body, 14px);
    background: var(--color-card);
  }
  .chip-on {
    background: var(--accent);
    color: var(--color-on-accent);
    border-color: var(--accent);
  }
  .act {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    color: var(--color-muted-foreground);
    border-radius: var(--radius-sm);
    padding: var(--space-1, 4px) var(--space-2, 8px);
    font-size: var(--font-size-body, 14px);
  }
  .act:hover {
    background: var(--hairline);
  }
  .act.del:hover {
    color: var(--color-destructive);
  }
</style>
