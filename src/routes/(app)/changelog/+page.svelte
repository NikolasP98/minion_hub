<script lang="ts">
  import { appLocale } from '$lib/utils/format';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { Megaphone } from 'lucide-svelte';
  import { Badge, iconSizes, PageHeader } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';

  interface ReleaseSections {
    [label: string]: { [scope: string]: string[] };
  }
  interface ReleasePr {
    number: number;
    title: string;
    url: string;
  }
  interface ReleaseRow {
    id: string;
    version: string;
    releasedAt: string | Date;
    sections: ReleaseSections;
    prs: ReleasePr[];
  }

  let { data }: { data: PageData } = $props();
  const releases = $derived(data.releases as ReleaseRow[]);

  const LABEL_VALUE: Record<string, 'success' | 'info'> = {
    Nuevo: 'success',
    Arreglado: 'info',
  };

  function fmtDate(value: string | Date): string {
    return new Date(value).toLocaleDateString(appLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
</script>

<PageShell archetype="collection" scroll="page" labelledBy="changelog-title">
  <PageHeader
    titleId="changelog-title"
    title={m.changelog_title()}
    subtitle={m.changelog_subtitle()}
  >
    {#snippet leading()}<Megaphone size={iconSizes.md} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>

  <PageBody width="content">
    {#if releases.length === 0}
      <p class="changelog-empty">{m.changelog_empty()}</p>
    {:else}
      {#each releases as release (release.id)}
        <section id={release.version} class="changelog-release">
          <!-- The tag name minus its repo prefix (owner 2026-10-15): `v2026.10.15`. -->
          <h2>{release.version.replace(/^hub-/, '')}</h2>
          <p class="changelog-date">{fmtDate(release.releasedAt)}</p>
          {#each Object.entries(release.sections) as [label, byScope] (label)}
            <div class="changelog-section">
              {#if LABEL_VALUE[label]}
                <Badge variant="semantic" value={LABEL_VALUE[label]} size="sm">{label}</Badge>
              {:else}
                <Badge variant="neutral" size="sm">{label}</Badge>
              {/if}
              <ul>
                {#each Object.entries(byScope) as [scope, lines] (scope)}
                  {#each lines as line, i (`${scope}-${i}`)}
                    <li>
                      {#if scope}<span class="changelog-scope">{scope}</span>{/if}
                      {line}
                    </li>
                  {/each}
                {/each}
              </ul>
            </div>
          {/each}
          {#if release.prs.length > 0}
            <p class="changelog-prs">
              {#each release.prs as pr (pr.number)}
                <a href={pr.url} target="_blank" rel="noreferrer">#{pr.number}</a>
              {/each}
            </p>
          {/if}
        </section>
      {/each}
    {/if}
  </PageBody>
</PageShell>

<style>
  .changelog-release {
    display: grid;
    gap: var(--space-2, 8px);
    margin-bottom: var(--space-6, 24px);
  }
  .changelog-release h2 {
    font-size: var(--font-size-body, 14px);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-text-primary, var(--color-foreground));
  }
  .changelog-date,
  .changelog-empty {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-caption, 12px);
  }
  .changelog-section {
    display: grid;
    justify-items: start;
    gap: var(--space-2, 8px);
  }
  .changelog-section ul {
    display: grid;
    gap: var(--space-1, 4px);
    padding-left: var(--space-4, 16px);
    color: var(--color-text-primary, var(--color-foreground));
    font-size: var(--font-size-body, 14px);
    line-height: var(--line-height-body, 20px);
  }
  .changelog-scope {
    margin-right: var(--space-1, 4px);
    color: var(--color-text-secondary, var(--color-muted-foreground));
    font-family: var(--font-mono);
    font-size: var(--font-size-caption, 12px);
  }
  .changelog-prs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2, 8px);
    font-size: var(--font-size-caption, 12px);
  }
  .changelog-prs a {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
  }
</style>
