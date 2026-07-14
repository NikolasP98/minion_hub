<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { Plus, Trash2 } from 'lucide-svelte';
  import OverviewGraph from '$lib/components/overview/OverviewGraph.svelte';
  import EntityChip from '$lib/components/ui/EntityChip.svelte';
  import { Button, Input, PageHeader } from '$lib/components/ui';
  import {
    AsyncBoundary,
    FormFieldset,
    PageBody,
    PageShell,
    Sheet,
  } from '$lib/components/ui/foundations';
  import { visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
  import { areaRef, AREA_COLORS, AREA_ICON_KEYS, iconByName } from '$lib/types/entities';
  import { agentArchetype } from '$lib/utils/agent-display';
  import type { OrgArea } from '$server/services/org-areas.service';

  let { data } = $props();

  const org = $derived.by(() => {
    const orgs = (page.data.organizations ?? []) as Array<{ id: string; name: string }>;
    const active = page.data.activeOrgId as string | null;
    return (
      orgs.find((candidate) => candidate.id === active) ??
      orgs[0] ?? {
        id: 'org',
        name: 'Organization',
      }
    );
  });

  const agents = $derived(
    visibleAgents.value.map((agent) => ({
      id: agent.id,
      name: agent.name,
      archetype: agentArchetype(agent.id),
    })),
  );
  const members = $derived(data.members);

  let editing = $state(false);
  let busy = $state(false);
  let actionError = $state<string | null>(null);
  let newName = $state('');
  let newColor = $state(AREA_COLORS[0]);
  let newIcon = $state(AREA_ICON_KEYS[0]);
  let inspectorAsSheet = $state(false);

  onMount(() => {
    const query = window.matchMedia('(max-width: 1279.98px)');
    const sync = () => (inspectorAsSheet = query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });

  async function api(path: string, method: string, body?: unknown): Promise<boolean> {
    busy = true;
    actionError = null;
    try {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(await response.text());
      await invalidate('app:org-areas');
      return true;
    } catch (error) {
      actionError = error instanceof Error ? error.message : m.common_error();
      return false;
    } finally {
      busy = false;
    }
  }

  async function seed() {
    await api('/api/org-areas', 'POST', { seed: true });
  }

  async function createArea() {
    if (!newName.trim()) return;
    const created = await api('/api/org-areas', 'POST', {
      name: newName.trim(),
      color: newColor,
      icon: newIcon,
    });
    if (created) newName = '';
  }

  async function removeArea(id: string) {
    await api(`/api/org-areas/${id}`, 'DELETE');
  }

  async function toggleAgent(area: OrgArea, agentId: string) {
    const next = area.agentIds.includes(agentId)
      ? area.agentIds.filter((id) => id !== agentId)
      : [...area.agentIds, agentId];
    await api(`/api/org-areas/${area.id}`, 'PATCH', { agentIds: next });
  }

  async function toggleUser(area: OrgArea, userId: string) {
    const next = area.userIds.includes(userId)
      ? area.userIds.filter((id) => id !== userId)
      : [...area.userIds, userId];
    await api(`/api/org-areas/${area.id}`, 'PATCH', { userIds: next });
  }
</script>

{#snippet inspectorContent()}
  <div class="inspector-stack">
    {#if actionError}
      <p class="action-error" role="alert">{actionError}</p>
    {/if}

    <form
      class="area-form"
      onsubmit={(event) => {
        event.preventDefault();
        void createArea();
      }}
    >
      <FormFieldset
        legend={m.overview_newArea()}
        helper="Areas group agents and people around the work they share."
        disabled={busy}
      >
        <Input
          label="Area name"
          placeholder={m.overview_areaNamePlaceholder()}
          bind:value={newName}
        />

        <FormFieldset legend="Color">
          <div class="choice-grid" aria-label="Area color">
            {#each AREA_COLORS as color (color)}
              <Button
                variant={newColor === color ? 'outline' : 'ghost'}
                size="icon"
                class="choice-button"
                aria-label={m.overview_selectColor()}
                aria-pressed={newColor === color}
                onclick={() => (newColor = color)}
              >
                <span class="color-swatch" style={`background-color: ${color}`}></span>
              </Button>
            {/each}
          </div>
        </FormFieldset>

        <FormFieldset legend="Icon">
          <div class="choice-grid" aria-label="Area icon">
            {#each AREA_ICON_KEYS as iconKey (iconKey)}
              {@const Icon = iconByName(iconKey)}
              <Button
                variant={newIcon === iconKey ? 'outline' : 'ghost'}
                size="icon"
                class="choice-button"
                aria-label={iconKey}
                aria-pressed={newIcon === iconKey}
                onclick={() => (newIcon = iconKey)}
              >
                {#if Icon}<Icon size={14} />{/if}
              </Button>
            {/each}
          </div>
        </FormFieldset>

        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!newName.trim()}>
          <Plus size={14} />
          {m.overview_createArea()}
        </Button>
      </FormFieldset>
    </form>

    <AsyncBoundary
      state={data.areas.length === 0
        ? {
            kind: 'empty',
            title: 'No areas yet',
            description: 'Seed the default structure or create an area above.',
          }
        : { kind: 'ready' }}
      compact
    >
      <div class="area-list">
        {#each data.areas as area (area.id)}
          <section class="area-card" aria-label={area.name}>
            <div class="area-card-heading">
              <EntityChip ref={areaRef(area)} size="md" link={false} />
              <Button
                variant="danger"
                size="icon"
                aria-label={`${m.overview_deleteArea()}: ${area.name}`}
                title={m.overview_deleteArea()}
                disabled={busy}
                onclick={() => removeArea(area.id)}><Trash2 size={14} /></Button
              >
            </div>

            <details>
              <summary>{m.overview_agents()} ({area.agentIds.length})</summary>
              <div class="assignment-list">
                {#each agents as agent (agent.id)}
                  <label>
                    <input
                      type="checkbox"
                      checked={area.agentIds.includes(agent.id)}
                      disabled={busy}
                      onchange={() => toggleAgent(area, agent.id)}
                    />
                    <span>{agent.name ?? agent.id}</span>
                  </label>
                {/each}
              </div>
            </details>

            <details>
              <summary>{m.overview_users()} ({area.userIds.length})</summary>
              <div class="assignment-list">
                {#each members as member (member.id)}
                  <label>
                    <input
                      type="checkbox"
                      checked={area.userIds.includes(member.id)}
                      disabled={busy}
                      onchange={() => toggleUser(area, member.id)}
                    />
                    <span>{member.displayName ?? member.email ?? member.id}</span>
                  </label>
                {/each}
              </div>
            </details>
          </section>
        {/each}
      </div>
    </AsyncBoundary>
  </div>
{/snippet}

<PageShell archetype="canvas" scroll="none" labelledBy="overview-title">
  <PageHeader
    titleId="overview-title"
    title="Organization overview"
    subtitle="Live relationships between areas, agents, and people"
    sticky={false}
  >
    {#snippet secondaryActions()}
      {#if data.isAdmin && data.areas.length === 0}
        <Button variant="outline" size="sm" loading={busy} onclick={seed}>
          {m.overview_seedDefault()}
        </Button>
      {/if}
    {/snippet}
    {#snippet primaryActions()}
      {#if data.isAdmin}
        <Button
          variant={editing ? 'primary' : 'secondary'}
          size="sm"
          onclick={() => (editing = !editing)}
        >
          {editing ? m.overview_done() : m.overview_editAreas()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody padding="none" scroll="none" class="overview-stage">
    <div class="overview-layout" data-editing={editing ? 'true' : undefined}>
      <section class="graph-stage" aria-label="Organization relationship graph">
        <OverviewGraph
          {org}
          areas={data.areas}
          {agents}
          {members}
          subscriptions={data.subscriptions}
        />
      </section>

      {#if editing && data.isAdmin && !inspectorAsSheet}
        <aside class="area-inspector" aria-label={m.overview_editAreas()}>
          {@render inspectorContent()}
        </aside>
      {/if}
    </div>
  </PageBody>
</PageShell>

{#if data.isAdmin && inspectorAsSheet}
  <Sheet bind:open={editing} title={m.overview_editAreas()} placement="right" size="sm">
    {@render inspectorContent()}
  </Sheet>
{/if}

<style>
  :global(.overview-stage),
  .overview-layout,
  .graph-stage {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }
  .overview-layout {
    overflow: hidden;
  }
  .graph-stage {
    position: relative;
    overflow: hidden;
  }
  .area-inspector {
    position: relative;
    z-index: var(--layer-sticky, 10);
    width: min(20rem, 32vw);
    min-width: 18rem;
    flex: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-3, 12px);
    border-left: 1px solid var(--color-border-subtle, var(--hairline));
    background: var(--color-surface-2, var(--elevation-2-bg));
    scrollbar-gutter: stable;
  }
  .inspector-stack,
  .area-list {
    display: grid;
    gap: var(--space-3, 12px);
  }
  .area-form,
  .area-card {
    padding: var(--space-3, 12px);
    border: 1px solid var(--color-border-subtle, var(--hairline));
    border-radius: var(--radius-lg);
    background: var(--color-surface-1, var(--elevation-1-bg));
  }
  .action-error {
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border: 1px solid var(--color-danger-border, var(--color-destructive));
    border-radius: var(--radius-md);
    color: var(--color-danger-fg, var(--color-destructive));
    background: var(--color-danger-surface, transparent);
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
  }
  .choice-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px);
  }
  :global(.choice-button) {
    width: 1.75rem;
    height: 1.75rem;
  }
  .color-swatch {
    display: block;
    width: 0.875rem;
    height: 0.875rem;
    border: 1px solid var(--color-border-default, var(--color-border));
    border-radius: var(--radius-full);
  }
  .area-card {
    display: grid;
    gap: var(--space-2, 8px);
  }
  .area-card-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
  }
  details {
    min-width: 0;
    color: var(--color-text-secondary, var(--color-muted));
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
  }
  summary {
    padding-block: var(--space-1, 4px);
    cursor: pointer;
  }
  summary:hover,
  summary:focus-visible {
    color: var(--color-text-primary, var(--color-foreground));
  }
  .assignment-list {
    display: grid;
    max-height: 10rem;
    margin-top: var(--space-1, 4px);
    gap: var(--space-1, 4px);
    overflow-y: auto;
  }
  .assignment-list label {
    display: flex;
    min-width: 0;
    min-height: var(--control-height-sm, 32px);
    align-items: center;
    gap: var(--space-2, 8px);
    cursor: pointer;
  }
  .assignment-list span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 1279.98px) {
    .graph-stage {
      width: 100%;
    }
  }
</style>
