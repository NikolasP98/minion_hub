<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { Megaphone } from 'lucide-svelte';
  import { PageHeader } from '$lib/components/ui';
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

  function fmtDate(value: string | Date): string {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
</script>

<PageShell archetype="collection" scroll="page" labelledBy="changelog-title">
  <PageHeader titleId="changelog-title" title={m.changelog_title()} subtitle={m.changelog_subtitle()}>
    {#snippet leading()}<Megaphone size={16} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>

  <PageBody width="content">
    {#if releases.length === 0}
      <p class="changelog-empty">{m.changelog_empty()}</p>
    {:else}
      {#each releases as release (release.id)}
        <section id={release.version} class="changelog-release">
          <h2>{m.changelog_novedades({ version: release.version })}</h2>
          <p class="changelog-date">{fmtDate(release.releasedAt)}</p>
          {#each Object.entries(release.sections) as [label, byScope] (label)}
            <div class="changelog-section">
              <strong>{label}</strong>
              {#each Object.entries(byScope) as [scope, lines] (scope)}
                <ul>
                  {#each lines as line, i (i)}
                    <li>{scope ? `(${scope}) ` : ''}{line}</li>
                  {/each}
                </ul>
              {/each}
            </div>
          {/each}
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
  .changelog-section strong {
    color: var(--color-text-primary, var(--color-foreground));
    font-size: var(--font-size-caption, 12px);
  }
</style>
