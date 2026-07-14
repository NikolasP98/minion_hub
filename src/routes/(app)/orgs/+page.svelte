<script lang="ts">
  import { Building2 } from 'lucide-svelte';
  import { PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';

  const { data } = $props();
</script>

<PageShell archetype="collection" scroll="page" labelledBy="organizations-title">
  <PageHeader
    titleId="organizations-title"
    title="All organizations"
    subtitle="Organizations available to this administrator"
  >
    {#snippet leading()}<Building2 size={16} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>
  <PageBody width="content">
    <AsyncBoundary
      state={data.orgs.length === 0
        ? {
            kind: 'empty',
            title: 'No organizations found',
            description: 'Organizations will appear here after they are created.',
          }
        : { kind: 'ready' }}
    >
      <ul class="organization-list" aria-label="Organizations">
        {#each data.orgs as organization (organization.id)}
          <li class="organization-row">
            <span class="organization-mark" aria-hidden="true">
              <Building2 size={16} />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-foreground">
                {organization.name}
              </span>
              <span class="block truncate font-mono text-xs text-muted">
                {organization.slug} · {organization.members} members
              </span>
            </span>
          </li>
        {/each}
      </ul>
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  .organization-list {
    display: grid;
    gap: var(--space-2, 8px);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .organization-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border: 1px solid var(--color-border-subtle, var(--hairline));
    border-radius: var(--radius-lg);
    background: var(--color-surface-2, var(--elevation-2-bg));
  }
  .organization-mark {
    display: inline-flex;
    width: var(--control-height-md, 36px);
    height: var(--control-height-md, 36px);
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
</style>
